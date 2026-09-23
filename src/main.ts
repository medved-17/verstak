// Точка входа: вход, открытие пространства, каркас приложения и маршрутизация по hash
// (#/my, #/board, #/list/<id>, #/people, #/feed).
import './styles.css';
import { authErrorText, initials, signInWithGoogle, signOut, watchUser, type User } from './auth';
import {
  acceptInvite,
  InviteError,
  getLiveError,
  getMembers,
  getReads,
  getWrites,
  getSession,
  getTasks,
  getViews,
  isDone,
  isLoaded,
  onChange,
  openSession,
  probeTasks,
  probeWrite,
  SessionError,
  startDemo,
  startLive,
  stopLive,
  toggleDone,
  type Role,
} from './store';
import { avatarHtml } from './ui/avatar';
import { esc, pl } from './ui/dom';
import { openInviteForm } from './ui/invite-form';
import { openTaskDetail } from './ui/task-detail';
import { openTaskForm } from './ui/task-form';
import { toast, writeErrorText } from './ui/toast';
import { viewBoard } from './views/board';
import { viewFeed } from './views/feed';
import { ALL, countForView, viewList } from './views/list';
import { viewMy } from './views/my';
import { viewPeople } from './views/people';
import { viewTimeline } from './views/timeline';
import type { ViewResult } from './views/types';

// Счётчики чтений и записей доступны из консоли всегда, отладка правил — только при npm run dev
Object.assign(window, { verstak: { reads: getReads, writes: getWrites, ...(import.meta.env.DEV ? { probeTasks, probeWrite, tasks: getTasks } : {}) } });

const app = document.querySelector<HTMLDivElement>('#app')!;

// ---------- Служебные экраны ----------

function renderLoading(text = 'Загрузка…'): void {
  app.innerHTML = `<main class="gate"><div class="panel"><p class="muted">${esc(text)}</p></div></main>`;
}

function renderSignedOut(error: string | null = null): void {
  app.innerHTML = `
    <main class="gate">
      <div class="panel">
        <h1>Верстак</h1>
        <p class="lead">${
          pendingInvite() ? 'Вас пригласили в пространство. Войдите, чтобы принять приглашение.' : 'Трекер задач команды. Войдите, чтобы увидеть свои задачи.'
        }</p>
        <button class="btn pri" id="signin">Войти через Google</button>
        ${error ? `<p class="err">${esc(error)}</p>` : ''}
      </div>
    </main>`;
  const btn = app.querySelector<HTMLButtonElement>('#signin')!;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await signInWithGoogle();
    } catch (e) {
      renderSignedOut(authErrorText(e));
    }
  });
}

function renderSessionError(user: User, error: string): void {
  app.innerHTML = `
    <main class="gate">
      <div class="panel">
        <h1>Верстак</h1>
        <p class="muted">${esc(user.email ?? '')}</p>
        <p class="err">${esc(error)}</p>
        <button class="btn" id="signout">Выйти</button>
      </div>
    </main>`;
  app.querySelector('#signout')!.addEventListener('click', () => signOut());
}

// ---------- Маршрут ----------

type RouteName = 'my' | 'board' | 'timeline' | 'list' | 'people' | 'feed';

interface Route {
  name: RouteName;
  arg: string;
}

function parseRoute(): Route {
  const [name = '', arg = ''] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'board' || name === 'timeline' || name === 'people' || name === 'feed') return { name, arg: '' };
  if (name === 'list' && arg) return { name, arg: decodeURIComponent(arg) };
  return { name: 'my', arg: '' };
}

// Приглашение: #/invite/<токен>. Токен запоминаем до входа — на случай входа через redirect.
const INVITE_KEY = 'verstak.invite';

function inviteFromHash(): string | null {
  const m = location.hash.match(/^#\/invite\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function pendingInvite(): string | null {
  const fromHash = inviteFromHash();
  if (fromHash) {
    try {
      sessionStorage.setItem(INVITE_KEY, fromHash);
    } catch {
      // хранилище недоступно — обойдёмся hash
    }
    return fromHash;
  }
  try {
    return sessionStorage.getItem(INVITE_KEY);
  } catch {
    return null;
  }
}

function forgetInvite(): void {
  try {
    sessionStorage.removeItem(INVITE_KEY);
  } catch {
    // нечего чистить
  }
}

const INVITE_ERRORS: Record<InviteError['reason'], string> = {
  'not-found': 'Приглашение не найдено. Проверьте ссылку.',
  used: 'Это приглашение уже использовано. Попросите новую ссылку.',
  expired: 'Срок приглашения истёк. Попросите новую ссылку.',
};

function go(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
}

// ---------- Каркас приложения ----------

const NAV: { v: RouteName; ic: string; label: string }[] = [
  { v: 'my', ic: '◎', label: 'Мои задачи' },
  { v: 'board', ic: '▤', label: 'Доска' },
  { v: 'timeline', ic: '┅', label: 'Шкала сроков' },
  { v: 'people', ic: '◍', label: 'Люди' },
  { v: 'feed', ic: '≡', label: 'Лента' },
];

function renderShell(): void {
  const s = getSession()!;
  app.innerHTML = `
    <div class="app">
      <aside class="side">
        <div class="ws"><span class="av">${esc(initials(s.workspace.name))}</span><span><span class="nm">${esc(s.workspace.name)}</span><br><span class="sub" id="ws-sub"></span></span></div>
        <div class="nav" id="nav">
          ${NAV.map((n) => `<button data-v="${n.v}" aria-current="false"><span class="ic">${n.ic}</span>${n.label}<span class="cnt" id="c-${n.v}"></span></button>`).join('')}
        </div>
        <div>
          <div class="sgrp">Виды</div>
          <div class="nav tree" id="tree"></div>
        </div>
        <div class="foot"><span id="me-av"></span><span class="nm">${esc(s.me.name)}</span><button class="btn" id="signout">Выйти</button></div>
      </aside>
      <div class="pane">
        <nav class="mnav" id="mnav" aria-label="Разделы"></nav>
        <div class="bar" id="bar"></div>
        <div class="body" id="body"></div>
      </div>
    </div>`;
  app.querySelector('#nav')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
    if (b) go('#/' + b.dataset.v);
  });
  // Боковая панель и мобильная полоса разделов ведут себя одинаково
  const onNavClick = (e: Event) => {
    const t = e.target as HTMLElement;
    const v = t.closest<HTMLButtonElement>('button[data-v]');
    if (v) go('#/' + v.dataset.v);
    const l = t.closest<HTMLButtonElement>('button[data-list]');
    if (l) go('#/list/' + encodeURIComponent(l.dataset.list!));
    if (t.closest('[data-act=signout]')) void signOut();
  };
  app.querySelector('#tree')!.addEventListener('click', onNavClick);
  app.querySelector('#mnav')!.addEventListener('click', onNavClick);
  app.querySelector('#signout')!.addEventListener('click', () => signOut());

  // Общие действия во всех видах: создать задачу, открыть задачу по клику
  app.querySelector('.pane')!.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-act=add]')) {
      openTaskForm();
      return;
    }
    if (t.closest('[data-act=invite]')) {
      openInviteForm();
      return;
    }
    // Пустая клетка шкалы сроков — новая задача на этот день и этого человека
    const slot = t.closest<HTMLElement>('.tl-c[data-due]');
    if (slot && !t.closest('.tl-dot')) {
      openTaskForm({ due: slot.dataset.due!, assignees: slot.dataset.uid ? [slot.dataset.uid] : [] });
      return;
    }
    const chk = t.closest<HTMLElement>('.chk[data-id]');
    if (chk) {
      toggleDone(chk.dataset.id!).catch((err) => toast(writeErrorText(err), 'bad'));
      return;
    }
    const card = t.closest<HTMLElement>('.t-card[data-id], .row[data-id], .tl-dot[data-id]');
    if (card) openTaskDetail(card.dataset.id!);
    const ev = t.closest<HTMLElement>('.fitem[data-task]');
    if (ev) openTaskDetail(ev.dataset.task!);
  });
}

function renderNav(route: Route): void {
  const s = getSession()!;
  const tasks = getTasks();
  const nMembers = getMembers().length;
  app.querySelectorAll<HTMLButtonElement>('#nav button').forEach((b) =>
    b.setAttribute('aria-current', String(b.dataset.v === route.name)),
  );
  // Виды: «Все задачи» и сохранённые — с числом задач, как в макете
  const loaded = isLoaded();
  const cur = (id: string) => String(route.name === 'list' && route.arg === id);
  app.querySelector('#tree')!.innerHTML = [
    `<button data-list="${ALL}" aria-current="${cur(ALL)}"><span class="ic">▦</span>Все задачи<span class="cnt">${loaded ? tasks.length : ''}</span></button>`,
    ...getViews().map(
      (v) =>
        `<button data-list="${esc(v.id)}" aria-current="${cur(v.id)}"><span class="ic">${esc(v.icon)}</span>${esc(v.name)}<span class="cnt">${loaded ? countForView(v) : ''}</span></button>`,
    ),
  ].join('');
  const set = (id: string, text: string) => {
    const el = app.querySelector('#' + id);
    if (el) el.textContent = loaded ? text : '';
  };
  // Полоса разделов для телефона: разделы, виды, выход
  const mnav = app.querySelector<HTMLElement>('#mnav')!;
  const scroll = mnav.scrollLeft;
  mnav.innerHTML = [
    `<span class="ws"><span class="av">${esc(initials(s.workspace.name))}</span></span>`,
    ...NAV.map((n) => `<button data-v="${n.v}" aria-current="${n.v === route.name}">${n.label}</button>`),
    '<span class="sep"></span>',
    `<button data-list="${ALL}" aria-current="${cur(ALL)}">Все задачи</button>`,
    ...getViews().map((v) => `<button data-list="${esc(v.id)}" aria-current="${cur(v.id)}">${esc(v.icon)} ${esc(v.name)}</button>`),
    '<span class="sep"></span>',
    '<button data-act="signout">Выйти</button>',
  ].join('');
  mnav.scrollLeft = scroll;

  set('c-my', String(tasks.filter((t) => t.assignees.includes(s.uid) && !isDone(t)).length));
  set('c-board', String(tasks.length));
  set('c-people', String(nMembers));
  set('ws-sub', pl(nMembers, 'участник', 'участника', 'участников'));
  app.querySelector('#me-av')!.innerHTML = avatarHtml(s.uid);
}

function viewFor(route: Route): ViewResult {
  switch (route.name) {
    case 'board':
      return viewBoard();
    case 'timeline':
      return viewTimeline();
    case 'list':
      return viewList(route.arg);
    case 'people':
      return viewPeople();
    case 'feed':
      return viewFeed();
    default:
      return viewMy();
  }
}

function renderPane(route: Route): void {
  const bar = app.querySelector<HTMLElement>('#bar')!;
  const body = app.querySelector<HTMLElement>('#body')!;
  const error = getLiveError();
  if (error) {
    bar.innerHTML = '<h3>Верстак</h3>';
    body.innerHTML = `<p class="err">${esc(error)}</p>`;
    return;
  }
  if (!isLoaded()) {
    bar.innerHTML = '<h3>Верстак</h3>';
    body.innerHTML = '<div class="empty2">Загрузка задач…</div>';
    return;
  }
  // Сохраняем фокус и курсор: данные могут прийти, пока человек печатает в поле поиска
  const active = document.activeElement as HTMLInputElement | null;
  const focusId = active && active.id && bar.parentElement!.contains(active) ? active.id : '';
  const sel = focusId && 'selectionStart' in active! ? [active!.selectionStart, active!.selectionEnd] : null;
  const v = viewFor(route);
  bar.innerHTML = v.bar;
  body.innerHTML = v.body;
  v.mount?.(app.querySelector<HTMLElement>('.pane')!);
  if (focusId) {
    const el = document.getElementById(focusId) as HTMLInputElement | null;
    el?.focus();
    if (el && sel && sel[0] !== null) {
      try {
        el.setSelectionRange(sel[0], sel[1]);
      } catch {
        // у select и кнопок нет выделения
      }
    }
  }
}

function render(): void {
  if (!getSession()) return;
  const route = parseRoute();
  renderNav(route);
  renderPane(route);
}

// Изменения стора приходят пачками — перерисовываем один раз после пачки.
// Микрозадача, а не requestAnimationFrame: тот не срабатывает в фоновой вкладке,
// и экран отставал бы от данных до возвращения на вкладку.
let pending = false;
function scheduleRender(): void {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    render();
  });
}

onChange(scheduleRender);
window.addEventListener('hashchange', () => {
  // Ссылка-приглашение открыта во вкладке, где уже выполнен вход, — принимаем заново с начала
  if (inviteFromHash() && getSession()) {
    pendingInvite();
    location.reload();
    return;
  }
  render();
});

// ---------- Тема ----------
// Как в макете: по умолчанию — как в системе, кнопка переключает светлую и тёмную.
// Выбор запоминается в браузере (только удобство: без хранилища всё равно работает).

const THEME_KEY = 'verstak.theme';
const themeBtn = document.createElement('button');
themeBtn.className = 'themebtn';
themeBtn.type = 'button';

function isDark(): boolean {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

function syncThemeBtn(): void {
  themeBtn.textContent = isDark() ? 'Светлая тема' : 'Тёмная тема';
}

try {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') document.documentElement.setAttribute('data-theme', saved);
} catch {
  // хранилище недоступно — тема как в системе
}
themeBtn.addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // не запомним — не страшно
  }
  syncThemeBtn();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeBtn);
syncThemeBtn();
document.body.append(themeBtn);

// ---------- Нет связи ----------
// Изменения при этом не теряются: локальный кэш Firestore отправит их, когда связь вернётся.

const offline = document.createElement('div');
offline.className = 'offline';
offline.setAttribute('role', 'status');
offline.textContent = 'Нет связи — изменения сохранятся, когда она появится';
function syncOnline(): void {
  offline.hidden = navigator.onLine;
}
window.addEventListener('online', syncOnline);
window.addEventListener('offline', syncOnline);
syncOnline();
document.body.append(offline);

// ---------- Горячие клавиши: N — новая задача, / — поиск ----------
// По физической клавише (code), чтобы работало и в русской раскладке.

document.addEventListener('keydown', (e) => {
  if (!getSession() || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  if (e.code === 'KeyN') {
    e.preventDefault();
    openTaskForm();
  } else if (e.code === 'Slash') {
    e.preventDefault();
    if (parseRoute().name !== 'list') {
      go('#/list/' + ALL);
      render(); // hashchange придёт позже — рисуем сразу, чтобы было куда ставить фокус
    }
    app.querySelector<HTMLInputElement>('#f-q')?.focus();
  }
});

// ---------- Вход и выход ----------

async function onSignedIn(user: User): Promise<void> {
  renderLoading('Открываем пространство…');
  // Сначала приглашение: иначе новому человеку создалось бы своё пустое пространство
  let inviteNote: string | null = null;
  const token = pendingInvite();
  if (token) {
    try {
      await acceptInvite(user, token);
    } catch (e) {
      console.error('Приглашение не принято', e);
      inviteNote = e instanceof InviteError ? INVITE_ERRORS[e.reason] : 'Не удалось принять приглашение. Проверьте связь и откройте ссылку ещё раз.';
    }
    forgetInvite();
    history.replaceState(null, '', location.pathname + location.search + '#/my');
  }
  try {
    await openSession(user);
  } catch (e) {
    console.error('Не удалось открыть пространство', e);
    const code = e instanceof SessionError ? e.code : (e as { code?: string }).code;
    const where = e instanceof SessionError ? ` Шаг: ${e.step}, код: ${e.code}.` : '';
    renderSessionError(
      user,
      (code === 'permission-denied'
        ? 'Нет доступа к данным: проверьте, что правила Firestore опубликованы.'
        : 'Не удалось открыть пространство. Проверьте связь и обновите страницу.') + where,
    );
    return;
  }
  renderShell();
  startLive();
  render();
  if (inviteNote) toast(inviteNote, 'bad');
  else if (token) toast(`Вы в пространстве «${getSession()!.workspace.name}»`);
}

async function startDemoMode(): Promise<void> {
  const d = await import('./demo');
  // ?demo=commenter — посмотреть интерфейс под другой ролью
  const role = new URLSearchParams(location.search).get('demo') as Role | '';
  const members = d.demoMembers.map((m) => (m.uid === d.DEMO_UID && role ? { ...m, role } : m));
  startDemo({ workspace: d.demoWorkspace, members, tasks: d.demoTasks, uid: d.DEMO_UID, views: d.demoViews });
  renderShell();
  render();
}

renderLoading();
if (import.meta.env.DEV && new URLSearchParams(location.search).has('demo')) {
  void startDemoMode();
} else watchUser((user) => {
  if (user) {
    void onSignedIn(user);
  } else {
    stopLive();
    renderSignedOut();
  }
});
