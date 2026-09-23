// Ночной бэкап: выгрузка всей базы Firestore в один JSON-файл.
// Без сторонних пакетов — вход сервисным ключом через node:crypto и REST API Firestore.
//
//   FIREBASE_SERVICE_ACCOUNT='<json ключа>' node .github/scripts/backup.mjs путь/к/файлу.json
//
// Сервисный ключ обходит правила доступа (это доступ администратора), поэтому
// скрипт только читает. Каждый документ — одно чтение из суточного лимита.

import { createSign } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCOPE = 'https://www.googleapis.com/auth/datastore';
const PAGE = 300;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Токен доступа по сервисному ключу (JWT, подписанный RS256). */
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(sa.private_key, 'base64url');
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${head}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Не удалось получить токен: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

/** Значение Firestore REST → обычный JSON. Метки времени — строками ISO. */
export function plain(v) {
  if (!v || typeof v !== 'object') return v;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return { $ref: v.referenceValue.replace(/^projects\/[^/]+\/databases\/[^/]+\/documents\//, '') };
  if ('geoPointValue' in v) return { $geo: v.geoPointValue };
  if ('bytesValue' in v) return { $bytes: v.bytesValue };
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(plain);
  if ('mapValue' in v) return fields(v.mapValue.fields);
  return v;
}

export function fields(f = {}) {
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, plain(v)]));
}

/** JSON с отсортированными ключами — чтобы соседние бэкапы сравнивались построчно. */
export function stableStringify(value) {
  const sort = (x) =>
    Array.isArray(x)
      ? x.map(sort)
      : x && typeof x === 'object'
        ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])]))
        : x;
  return JSON.stringify(sort(value), null, 2) + '\n';
}

function client(project, token) {
  const root = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
  let reads = 0;

  async function call(url, init) {
    const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    if (!res.ok) throw new Error(`Firestore ${res.status}: ${await res.text()}`);
    return res.json();
  }

  /** Имена подколлекций документа (или корня, если path пустой). */
  async function collectionIds(path) {
    const ids = [];
    let pageToken;
    do {
      const r = await call(`${root}${path ? '/' + path : ''}:listCollectionIds`, {
        method: 'POST',
        body: JSON.stringify({ pageSize: 100, pageToken }),
      });
      ids.push(...(r.collectionIds ?? []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return ids.sort();
  }

  /** Коллекция целиком, с подколлекциями: { id: { ...поля, $sub: { имя: {...} } } }. */
  async function dumpCollection(path) {
    const out = {};
    let pageToken;
    do {
      // showMissing — чтобы не потерять подколлекции у «пустых» документов
      const q = new URLSearchParams({ pageSize: String(PAGE), showMissing: 'true' });
      if (pageToken) q.set('pageToken', pageToken);
      const r = await call(`${root}/${path}?${q}`);
      for (const d of r.documents ?? []) {
        const id = d.name.split('/').pop();
        const docPath = `${path}/${id}`;
        const entry = d.fields ? fields(d.fields) : { $missing: true };
        if (d.fields) reads++;
        const subs = await collectionIds(docPath);
        if (subs.length) {
          entry.$sub = {};
          for (const c of subs) entry.$sub[c] = await dumpCollection(`${docPath}/${c}`);
        }
        out[id] = entry;
      }
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  return { collectionIds, dumpCollection, reads: () => reads };
}

/** Выгрузить базу в file; raw — JSON сервисного ключа. Возвращает строку-итог. */
export async function backup(file, raw) {
  if (!file) throw new Error('Укажите файл: node backup.mjs путь.json');
  if (!raw) throw new Error('Нет секрета FIREBASE_SERVICE_ACCOUNT');
  const sa = JSON.parse(raw);

  const token = await accessToken(sa);
  const fs = client(sa.project_id, token);
  const collections = {};
  for (const c of await fs.collectionIds('')) collections[c] = await fs.dumpCollection(c);

  const backup = { project: sa.project_id, exportedAt: new Date().toISOString(), collections };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, stableStringify(backup));

  const count = (tree) =>
    Object.values(tree).reduce((n, d) => n + 1 + Object.values(d.$sub ?? {}).reduce((m, c) => m + count(c), 0), 0);
  const total = Object.values(collections).reduce((n, c) => n + count(c), 0);
  return `Готово: ${total} документов (${fs.reads()} чтений), коллекции: ${Object.keys(collections).join(', ') || 'нет'}`;
}

// Запуск из командной строки (не при импорте в проверке). pathToFileURL — чтобы пути с кириллицей совпадали.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backup(process.argv[2], process.env.FIREBASE_SERVICE_ACCOUNT).then(console.log, (e) => {
    console.error(e.message);
    process.exit(1);
  });
}
