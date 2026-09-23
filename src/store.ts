// Единственное место, где есть обращения к Firestore. Вьюхи читают состояние
// и вызывают методы стора — так чтения можно посчитать и ограничить в одном месте.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
  writeBatch,
  type DocumentSnapshot,
  type QuerySnapshot,
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

/** Ключ статуса «Готово»: 'done', а если его нет в настройках — последняя колонка. */
export function doneKey(): string {
  const st = session?.workspace.statuses ?? DEFAULT_STATUSES;
  return st.some((x) => x.key === 'done') ? 'done' : (st[st.length - 1]?.key ?? 'done');
}

/** Куда возвращается задача при снятии отметки: «В работе», иначе первая колонка. */
export function reopenKey(): string {
  const st = session?.workspace.statuses ?? DEFAULT_STATUSES;
  return st.some((x) => x.key === 'now') ? 'now' : (st[0]?.key ?? 'now');
}

export function isDone(t: Task): boolean {
  return t.status === doneKey();
}

export function statusName(key: string): string {
  return session?.workspace.statuses.find((x) => x.key === key)?.name ?? key;
}

/** Отметка выполнения: одна запись статуса. */
export function toggleDone(id: string): Promise<void> {
  const t = tasks.get(id)!;
  return updateTask(id, { status: isDone(t) ? reopenKey() : doneKey() });
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

// ---------- Права в интерфейсе ----------
// Настоящая проверка — в firestore.rules; здесь только решаем, какие кнопки показывать.

const myRole = (): Role | undefined => session?.me.role;

export const can = {
  /** Создавать и править любые задачи. */
  editTasks: () => ['owner', 'admin', 'member'].includes(myRole() ?? ''),
  /** Менять статус и порядок задачи: участник и выше — любой, комментатор — своей. */
  moveTask: (t: Task) =>
    can.editTasks() || (myRole() === 'commenter' && !!session && t.assignees.includes(session.uid)),
  /** Писать комментарии. */
  comment: () => !!myRole() && myRole() !== 'viewer',
  /** Приглашать людей. */
  invite: () => myRole() === 'owner' || myRole() === 'admin',
  /** Менять роль участника: не себе и не владельцу. */
  changeRole: (m: Member) => can.invite() && !!session && m.uid !== session.uid && m.role !== 'owner',
};

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

/** oneShot — разовый запрос: пустой ответ сервера всё равно стоит одно чтение. */
function countQuery(snap: QuerySnapshot, what: string, oneShot = false): void {
  if (snap.metadata.fromCache) return;
  const n = snap.docChanges().length;
  countReads(oneShot ? Math.max(1, n) : n, what);
}

export function getReads(): number {
  return reads;
}

// Записи считаем так же — лимит бесплатного тарифа 20 000 в сутки
let writes = 0;

function countWrites(n: number, what: string): void {
  writes += n;
  console.debug(`[записи] +${n} ${what}, всего ${writes}`);
}

export function getWrites(): number {
  return writes;
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
    countQuery(snap, 'проба задач', true);
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
        // Роль могли сменить, пока человек в приложении — берём из подписки, без лишних чтений
        const me = session && members.get(session.uid);
        if (session && me) session.me = me;
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
  countWrites(1, 'новая задача');
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
  countWrites(1, 'правка задачи: ' + Object.keys(data).join(', '));
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

/**
 * Перетаскивание: поставить задачу в колонку status на место index (среди остальных
 * задач колонки, без неё самой). Новый order — среднее соседей, одна запись:
 * status, order и служебные updated*. Если соседи ближе 1e-6 — колонка
 * перенумеровывается целиком одним пакетом (раз в сотни перетаскиваний).
 * Возвращает false, если место не изменилось и писать нечего.
 */
export function moveTask(id: string, status: string, index: number): Promise<void> | false {
  const s = session!;
  const t = tasks.get(id);
  if (!t) return false;
  const col = [...tasks.values()]
    .filter((x) => x.status === status && x.id !== id)
    .sort((a, b) => a.order - b.order);
  const i = Math.max(0, Math.min(index, col.length));
  const prev = col[i - 1];
  const next = col[i];

  // Уже стоит здесь — ничего не пишем
  if (t.status === status && (!prev || prev.order < t.order) && (!next || t.order < next.order)) return false;

  let order: number;
  if (prev && next) order = (prev.order + next.order) / 2;
  else if (prev) order = prev.order + 1;
  else if (next) order = next.order - 1;
  else order = 1;

  const tooClose = (prev && order - prev.order < 1e-6) || (next && next.order - order < 1e-6);
  const ref = (taskId: string) => doc(db, 'workspaces', s.workspace.id, 'tasks', taskId);
  countWrites(tooClose ? col.length + 1 : 1, tooClose ? 'перенумерация колонки' : 'перенос карточки');

  if (demo) {
    if (tooClose) {
      const list = [...col.slice(0, i), t, ...col.slice(i)];
      list.forEach((x, k) => tasks.set(x.id, { ...tasks.get(x.id)!, order: k + 1, ...(x.id === id ? { status } : {}) }));
    } else {
      tasks.set(id, { ...t, status, order, updatedBy: s.uid });
    }
    emit();
    return Promise.resolve();
  }

  const batch = writeBatch(db);
  if (tooClose) {
    const list = [...col.slice(0, i), t, ...col.slice(i)];
    list.forEach((x, k) => {
      if (x.id === id) batch.update(ref(id), { status, order: k + 1, updatedBy: s.uid, updatedAt: serverTimestamp() });
      else if (x.order !== k + 1) batch.update(ref(x.id), { order: k + 1 });
    });
  } else {
    batch.update(ref(id), { status, order, updatedBy: s.uid, updatedAt: serverTimestamp() });
  }
  return batch.commit();
}

// ---------- Приглашения ----------

export const INVITE_DAYS = 7;

/** Роли, которые может выдать текущий человек: владелец и администратор — всё, кроме владельца. */
export function invitableRoles(): Role[] {
  return can.invite() ? ['admin', 'member', 'commenter', 'viewer'] : [];
}

/** Сменить роль участника. Одна запись. */
export function setRole(uid: string, role: Role): Promise<void> {
  const s = session!;
  countWrites(1, 'роль');
  if (demo) {
    const m = members.get(uid);
    if (m) members.set(uid, { ...m, role });
    emit();
    return Promise.resolve();
  }
  return writeBatch(db).update(doc(db, 'workspaces', s.workspace.id, 'members', uid), { role }).commit();
}

/** Создать приглашение на 7 дней. Одна запись. Возвращает токен и срок. */
export async function createInvite(role: Role): Promise<{ token: string; expiresAt: Date }> {
  const s = session!;
  const ref = doc(collection(db, 'invites'));
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400000);
  countWrites(1, 'приглашение');
  if (!demo) {
    await writeBatch(db)
      .set(ref, { ws: s.workspace.id, role, createdBy: s.uid, expiresAt: Timestamp.fromDate(expiresAt) })
      .commit();
  }
  return { token: ref.id, expiresAt };
}

export class InviteError extends Error {
  constructor(public reason: 'not-found' | 'used' | 'expired') {
    super(reason);
  }
}

/** Цвет аватара нового участника — по uid, чтобы не читать список участников до вступления. */
function colorFor(uid: string): string {
  let h = 0;
  for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/**
 * Принять приглашение: одним пакетом создать members/{uid} с ролью из приглашения,
 * пометить приглашение использованным и поставить пространство первым в профиле,
 * чтобы оно открывалось при входе. Уже состоящий в пространстве приглашение не тратит.
 */
export async function acceptInvite(user: User, token: string): Promise<string> {
  const invSnap = await getDoc(doc(db, 'invites', token));
  countDoc(invSnap, 'приглашение');
  if (!invSnap.exists()) throw new InviteError('not-found');
  const inv = invSnap.data() as { ws: string; role: Role; expiresAt: Timestamp; usedBy?: string };

  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  countDoc(userSnap, 'профиль');
  const list: string[] = userSnap.exists() ? (userSnap.data().workspaces ?? []) : [];
  const reordered = [inv.ws, ...list.filter((w) => w !== inv.ws)];

  if (list.includes(inv.ws) || inv.usedBy === user.uid) {
    // Уже участник — просто открыть это пространство
    if (list[0] !== inv.ws) await writeBatch(db).set(userRef, { workspaces: reordered }, { merge: true }).commit();
    return inv.ws;
  }
  if (inv.usedBy) throw new InviteError('used');
  if (inv.expiresAt.toMillis() < Date.now()) throw new InviteError('expired');

  const name = displayName(user);
  const email = user.email ?? '';
  const batch = writeBatch(db);
  batch.set(doc(db, 'workspaces', inv.ws, 'members', user.uid), {
    role: inv.role,
    name,
    email,
    color: colorFor(user.uid),
    joinedAt: serverTimestamp(),
    invite: token,
  });
  batch.update(doc(db, 'invites', token), { usedBy: user.uid });
  batch.set(userRef, { name, email, workspaces: reordered }, { merge: true });
  await batch.commit();
  return inv.ws;
}

// ---------- История задачи ----------

/** Событие ленты: создание, смена статуса, назначение, перенос срока. */
export interface ActivityEvent {
  id: string;
  actor: string;
  verb: 'created' | 'status' | 'assigned' | 'due' | string;
  taskId: string;
  taskTitle: string;
  at: Date | null;
  from?: string;
  to?: string;
}

let demoActivity: ActivityEvent[] = [];

function eventFrom(id: string, d: Record<string, unknown>): ActivityEvent {
  const at = d.at as Timestamp | null | undefined;
  return {
    id,
    actor: String(d.actor ?? ''),
    verb: String(d.verb ?? ''),
    taskId: String(d.taskId ?? ''),
    taskTitle: String(d.taskTitle ?? ''),
    at: at && typeof at.toDate === 'function' ? at.toDate() : null,
    from: d.from === undefined ? undefined : String(d.from),
    to: d.to === undefined ? undefined : String(d.to),
  };
}

/**
 * История задачи — события ленты по taskId. Читается только при открытии карточки.
 * Сортировка на месте, а не orderBy в запросе: так не нужен составной индекс.
 */
export async function loadTaskHistory(taskId: string): Promise<ActivityEvent[]> {
  const s = session!;
  let list: ActivityEvent[];
  if (demo) {
    list = demoActivity.filter((e) => e.taskId === taskId);
  } else {
    const snap = await getDocs(
      query(collection(db, 'workspaces', s.workspace.id, 'activity'), where('taskId', '==', taskId), limit(100)),
    );
    countQuery(snap, 'история задачи', true);
    list = snap.docs.map((d) => eventFrom(d.id, d.data()));
  }
  return list.sort((a, b) => (b.at?.getTime() ?? Date.now()) - (a.at?.getTime() ?? Date.now()));
}

// ---------- Комментарии ----------

export const COMMENT_MAX = 4000;

export interface Comment {
  id: string;
  text: string;
  author: string;
  at: Date | null;
}

const demoComments = new Map<string, Comment[]>();
const demoCommentListeners = new Map<string, Set<(list: Comment[]) => void>>();

/**
 * Подписка на комментарии задачи — только пока открыта карточка. Возвращает отписку.
 * Последние 200 по времени; время ещё не записанного сервером — оценка.
 */
export function watchComments(taskId: string, cb: (list: Comment[]) => void, onError: (e: unknown) => void): () => void {
  const s = session!;
  if (demo) {
    const set = demoCommentListeners.get(taskId) ?? new Set();
    set.add(cb);
    demoCommentListeners.set(taskId, set);
    cb(demoComments.get(taskId) ?? []);
    return () => set.delete(cb);
  }
  const q = query(
    collection(db, 'workspaces', s.workspace.id, 'tasks', taskId, 'comments'),
    orderBy('createdAt', 'desc'),
    limit(200),
  );
  let first = true;
  return onSnapshot(
    q,
    { includeMetadataChanges: false },
    (snap) => {
      // Пустой первый ответ сервера — всё равно одно чтение
      if (!snap.metadata.fromCache) countReads(first ? Math.max(1, snap.docChanges().length) : snap.docChanges().length, 'комментарии');
      first = false;
      cb(
        snap.docs
          .map((d) => {
            const data = d.data({ serverTimestamps: 'estimate' });
            const at = data.createdAt as Timestamp | null;
            return { id: d.id, text: String(data.text ?? ''), author: String(data.author ?? ''), at: at ? at.toDate() : null };
          })
          .reverse(),
      );
    },
    onError,
  );
}

/** Добавить комментарий. Одна запись; в ленту не попадает. */
export function addComment(taskId: string, text: string): Promise<void> {
  const s = session!;
  const clean = text.trim().slice(0, COMMENT_MAX);
  if (!clean) return Promise.resolve();
  countWrites(1, 'комментарий');
  if (demo) {
    const list = [...(demoComments.get(taskId) ?? []), { id: String(Date.now()), text: clean, author: s.uid, at: new Date() }];
    demoComments.set(taskId, list);
    demoCommentListeners.get(taskId)?.forEach((fn) => fn(list));
    return Promise.resolve();
  }
  const ref = doc(collection(db, 'workspaces', s.workspace.id, 'tasks', taskId, 'comments'));
  return writeBatch(db).set(ref, { text: clean, author: s.uid, createdAt: serverTimestamp() }).commit();
}

/** Демо-режим (только dev): состояние из готовых данных, без обращений к Firestore. */
export function startDemo(data: {
  workspace: Workspace;
  members: Member[];
  tasks: Task[];
  uid: string;
  activity?: ActivityEvent[];
}): void {
  demo = true;
  demoActivity = data.activity ?? [];
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
