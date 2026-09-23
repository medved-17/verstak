// Единственное место, где есть обращения к Firestore. Вьюхи читают состояние
// и вызывают методы стора — так чтения можно посчитать и ограничить в одном месте.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  type Timestamp,
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

export function clearSession(): void {
  session = null;
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
  const knownWs: string[] = known.exists() ? (known.data().workspaces ?? []) : [];

  const wsId = knownWs.length ? knownWs[0] : await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
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
    return `прочитано задач: ${snap.size}`;
  } catch (e) {
    return `ошибка: ${(e as { code?: string }).code ?? String(e)}`;
  }
}
