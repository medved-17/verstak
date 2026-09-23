// Единственное место, где есть обращения к Firestore. Вьюхи читают состояние
// и вызывают методы стора — так чтения можно посчитать и ограничить в одном месте.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type DocumentSnapshot,
  type QuerySnapshot,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { User } from './auth';

export type Role = 'owner' | 'admin' | 'member' | 'commenter' | 'viewer';

export interface Status {
  key: string;
  name: string;
  color: string;
}

export interface Workspace {
  id: string;
  name: string;
  statuses: Status[];
  tags: string[];
}

export interface Member {
  uid: string;
  role: Role;
  name: string;
  email: string;
  color: string;
  joinedAt?: Timestamp;
}

// Колонки по умолчанию — из макета. Ключ «done» означает «Готово» для отметки выполнения.
export const DEFAULT_STATUSES: Status[] = [
  { key: 'backlog', name: 'Очередь', color: '#8794A8' },
  { key: 'now', name: 'В работе', color: '#2440B5' },
  { key: 'review', name: 'На проверке', color: '#855100' },
  { key: 'done', name: 'Готово', color: '#1A6A4D' },
];

export type Priority = 1 | 2 | 3;

export interface Task {
  id: string;
  title: string;
  descr: string;
  status: string;
  assignees: string[];
  due: string | null; // 'YYYY-MM-DD'
  priority: Priority;
  tags: string[];
  order: number;
  createdBy: string;
  createdAt?: Timestamp;
  updatedBy: string;
  updatedAt?: Timestamp;
}

// Цвета аватаров — из макета
export const AVATAR_COLORS = ['#2440B5', '#1A6A4D', '#855100', '#5B3A8C', '#973040', '#657083'];

/** Сессия: держится в памяти после входа, роль не перечитывается перед каждым действием. */
export interface Session {
  uid: string;
  workspace: Workspace;
  me: Member;
}

let session: Session | null = null;

export function getSession(): Session | null {
  return session;
}

// ---------- Счётчик чтений ----------
// Считаем то, за что платим: документы, пришедшие с сервера. Снимки из локального
// кэша бесплатны и не считаются. Итог виден в консоли и через verstak.reads().

let reads = 0;

function countReads(n: number, what: string): void {
  if (n <= 0) return;
  reads += n;
  console.debug(`[чтения] +${n} ${what}, всего ${reads}`);
}

function countDoc(snap: DocumentSnapshot, what: string): void {
  if (!snap.metadata.fromCache) countReads(1, what);
}

function countQuery(snap: QuerySnapshot, what: string): void {
  if (!snap.metadata.fromCache) countReads(snap.docChanges().length, what);
}

export function getReads(): number {
  return reads;
}

function displayName(user: User): string {
  return user.displayName || user.email || 'Без имени';
}

/**
 * Первый вход: создать users/{uid}; если у человека нет пространства — создать
 * workspaces/{ws} со статусами по умолчанию и записать себя владельцем.
 * Всё в одной транзакции: две вкладки при первом входе не создадут два пространства.
 * Повторный вход — одно чтение профиля и по одному чтению пространства и участника.
 */
export async function openSession(user: User): Promise<Session> {
  const userRef = doc(db, 'users', user.uid);
  const name = displayName(user);
  const email = user.email ?? '';

  // Обычный путь: пространство уже есть. getDoc работает и из кэша, если нет связи.
  const known = await getDoc(userRef);
  countDoc(known, 'профиль');
  const knownWs: string[] = known.exists() ? (known.data().workspaces ?? []) : [];

  const wsId = knownWs.length ? knownWs[0] : await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    countReads(1, 'профиль (транзакция)');
    const existing: string[] = snap.exists() ? (snap.data().workspaces ?? []) : [];
    if (existing.length) return existing[0];

    const wsRef = doc(collection(db, 'workspaces'));
    const firstName = name.split(/\s+/)[0];
    tx.set(wsRef, {
      name: `Пространство ${firstName}`,
      statuses: DEFAULT_STATUSES,
      tags: [],
      createdAt: serverTimestamp(),
    });
    tx.set(doc(db, 'workspaces', wsRef.id, 'members', user.uid), {
      role: 'owner',
      name,
      email,
      color: AVATAR_COLORS[0],
      joinedAt: serverTimestamp(),
    });
    tx.set(userRef, { name, email, workspaces: [wsRef.id] }, { merge: true });
    return wsRef.id;
  });

  const [wsSnap, meSnap] = await Promise.all([
    getDoc(doc(db, 'workspaces', wsId)),
    getDoc(doc(db, 'workspaces', wsId, 'members', user.uid)),
  ]);
  countDoc(wsSnap, 'пространство');
  countDoc(meSnap, 'участник');
  if (!wsSnap.exists() || !meSnap.exists()) {
    throw new Error('Пространство или запись участника не найдены');
  }
  const ws = wsSnap.data();
  session = {
    uid: user.uid,
    workspace: { id: wsId, name: ws.name, statuses: ws.statuses ?? [], tags: ws.tags ?? [] },
    me: { uid: user.uid, ...(meSnap.data() as Omit<Member, 'uid'>) },
  };
  return session;
}

/**
 * Отладка правил (только dev): попытаться прочитать задачи произвольного пространства.
 * Для чужого пространства должен вернуться отказ permission-denied.
 */
export async function probeTasks(wsId: string): Promise<string> {
  try {
    const snap = await getDocs(collection(db, 'workspaces', wsId, 'tasks'));
    countQuery(snap, 'проба задач');
    return `прочитано задач: ${snap.size}`;
  } catch (e) {
    return `ошибка: ${(e as { code?: string }).code ?? String(e)}`;
  }
}

// ---------- Живое состояние пространства ----------
// Одна подписка на все задачи и одна на участников. Живут, пока открыта сессия;
// переключение между видами новых запросов не создаёт — вьюхи читают эти Map.

const tasks = new Map<string, Task>();
const members = new Map<string, Member>();
const listeners = new Set<() => void>();
let unsubs: Unsubscribe[] = [];
let loaded = { tasks: false, members: false };
let liveError: string | null = null;

export function getTasks(): Task[] {
  return [...tasks.values()];
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function getMembers(): Member[] {
  return [...members.values()];
}

export function getMember(uid: string): Member | undefined {
  return members.get(uid);
}

/** Задачи и участники получены хотя бы раз (из кэша или с сервера). */
export function isLoaded(): boolean {
  return loaded.tasks && loaded.members;
}

export function getLiveError(): string | null {
  return liveError;
}

/** Подписка на любые изменения состояния стора. Возвращает функцию отписки. */
export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  listeners.forEach((fn) => fn());
}

function onLiveError(e: unknown): void {
  const code = (e as { code?: string }).code;
  console.error('Подписка Firestore прервана', e);
  liveError =
    code === 'permission-denied'
      ? 'Нет доступа к данным пространства.'
      : 'Потеряна связь с базой. Обновите страницу.';
  emit();
}

function taskFrom(id: string, d: Record<string, unknown>): Task {
  return {
    id,
    title: String(d.title ?? ''),
    descr: String(d.descr ?? ''),
    status: String(d.status ?? ''),
    assignees: Array.isArray(d.assignees) ? (d.assignees as string[]) : [],
    due: typeof d.due === 'string' && d.due ? d.due : null,
    priority: d.priority === 1 || d.priority === 2 ? d.priority : 3,
    tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
    order: typeof d.order === 'number' ? d.order : 0,
    createdBy: String(d.createdBy ?? ''),
    createdAt: d.createdAt as Timestamp | undefined,
    updatedBy: String(d.updatedBy ?? ''),
    updatedAt: d.updatedAt as Timestamp | undefined,
  };
}

/** Запустить подписки пространства. Повторный вызов для того же пространства ничего не делает. */
export function startLive(): void {
  if (!session || unsubs.length) return;
  const wsId = session.workspace.id;

  unsubs.push(
    onSnapshot(
      collection(db, 'workspaces', wsId, 'tasks'),
      (snap) => {
        countQuery(snap, 'задачи');
        snap.docChanges().forEach((ch) => {
          if (ch.type === 'removed') tasks.delete(ch.doc.id);
          else tasks.set(ch.doc.id, taskFrom(ch.doc.id, ch.doc.data()));
        });
        loaded.tasks = true;
        emit();
      },
      onLiveError,
    ),
    onSnapshot(
      collection(db, 'workspaces', wsId, 'members'),
      (snap) => {
        countQuery(snap, 'участники');
        snap.docChanges().forEach((ch) => {
          if (ch.type === 'removed') members.delete(ch.doc.id);
          else members.set(ch.doc.id, { uid: ch.doc.id, ...(ch.doc.data() as Omit<Member, 'uid'>) });
        });
        loaded.members = true;
        emit();
      },
      onLiveError,
    ),
  );
}

// ---------- Запись задач ----------

export const TITLE_MAX = 200;
export const DESCR_MAX = 4000;

/** Поля задачи, которые правит человек. */
export interface TaskInput {
  title: string;
  descr: string;
  status: string;
  assignees: string[];
  due: string | null;
  priority: Priority;
  tags: string[];
}

let demo = false;

function cleanInput<T extends Partial<TaskInput>>(p: T): T {
  const out = { ...p };
  if (out.title !== undefined) out.title = out.title.trim().slice(0, TITLE_MAX);
  if (out.descr !== undefined) out.descr = out.descr.slice(0, DESCR_MAX);
  if (out.tags !== undefined) out.tags = [...new Set(out.tags.map((t) => t.trim()).filter(Boolean))];
  return out;
}

/** Все метки для подсказок: из настроек пространства и из самих задач — без запросов. */
export function getAllTags(): string[] {
  const set = new Set(session?.workspace.tags ?? []);
  tasks.forEach((t) => t.tags.forEach((g) => set.add(g)));
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
}

/** Порядок для новой задачи: наверх колонки, как в макете. */
function topOrder(status: string): number {
  let min = Infinity;
  tasks.forEach((t) => {
    if (t.status === status && t.order < min) min = t.order;
  });
  return min === Infinity ? 1 : min - 1;
}

/**
 * Создать задачу. Одна запись. Промис не ждём в интерфейсе: локальный кэш
 * применяет запись сразу, подписка показывает задачу до ответа сервера.
 */
export function createTask(input: TaskInput): Promise<string> {
  const s = session!;
  const data = cleanInput(input);
  const ref = doc(collection(db, 'workspaces', s.workspace.id, 'tasks'));
  const order = topOrder(data.status);
  if (demo) {
    tasks.set(ref.id, { id: ref.id, ...data, order, createdBy: s.uid, updatedBy: s.uid });
    emit();
    return Promise.resolve(ref.id);
  }
  const batch = writeBatch(db);
  batch.set(ref, {
    ...data,
    order,
    createdBy: s.uid,
    createdAt: serverTimestamp(),
    updatedBy: s.uid,
    updatedAt: serverTimestamp(),
  });
  return batch.commit().then(() => ref.id);
}

/** Изменить поля задачи. Одна запись; меняются только переданные поля и служебные updated*. */
export function updateTask(id: string, patch: Partial<TaskInput>): Promise<void> {
  const s = session!;
  const data: Partial<TaskInput> & { order?: number } = cleanInput(patch);
  // Смена статуса из окна задачи — наверх новой колонки
  const cur = tasks.get(id);
  if (data.status !== undefined && cur && data.status !== cur.status) data.order = topOrder(data.status);
  if (demo) {
    const t = tasks.get(id);
    if (t) tasks.set(id, { ...t, ...data, updatedBy: s.uid });
    emit();
    return Promise.resolve();
  }
  const batch = writeBatch(db);
  batch.update(doc(db, 'workspaces', s.workspace.id, 'tasks', id), {
    ...data,
    updatedBy: s.uid,
    updatedAt: serverTimestamp(),
  });
  return batch.commit();
}

/** Демо-режим (только dev): состояние из готовых данных, без обращений к Firestore. */
export function startDemo(data: { workspace: Workspace; members: Member[]; tasks: Task[]; uid: string }): void {
  demo = true;
  const me = data.members.find((m) => m.uid === data.uid)!;
  session = { uid: data.uid, workspace: data.workspace, me };
  data.members.forEach((m) => members.set(m.uid, m));
  data.tasks.forEach((t) => tasks.set(t.id, t));
  loaded = { tasks: true, members: true };
  emit();
}

/** Остановить подписки и очистить состояние (выход). */
export function stopLive(): void {
  unsubs.forEach((u) => u());
  unsubs = [];
  tasks.clear();
  members.clear();
  loaded = { tasks: false, members: false };
  liveError = null;
  session = null;
}
