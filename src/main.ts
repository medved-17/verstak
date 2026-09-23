// Точка входа: вход, открытие пространства, каркас приложения и маршрутизация по hash
// (#/my, #/board, #/list/<id>, #/people, #/feed).
import './styles.css';
import { authErrorText, initials, signInWithGoogle, signOut, watchUser, type User } from './auth';
import {
  getLiveError,
  getMembers,
  getReads,
  getSession,
  getTasks,
  isLoaded,
  onChange,
  openSession,
  probeTasks,
  startDemo,
  startLive,
  stopLive,
} from './store';
import { avatarHtml } from './ui/avatar';
import { esc, pl } from './ui/dom';
import { openTaskForm } from './ui/task-form';
import { viewBoard } from './views/board';
import { viewFeed } from './views/feed';
import { viewList } from './views/list';
import { viewMy } from './views/my';
import { viewPeople } from './views/people';
import type { ViewResult } from './views/types';

// Счётчик чтений доступен из консоли всегда, отладка правил — только при npm run dev
Object.assign(window, { verstak: { reads: getReads, ...(import.meta.env.DEV ? { probeTasks } : {}) } });

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
        <p class="lead">Трекер задач команды. Войдите, чтобы увидеть свои задачи.</p>
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

type RouteName = 'my' | 'board' | 'list' | 'people' | 'feed';

interface Route {
  name: RouteName;
  arg: string;
}

function parseRoute(): Route {
  const [name = '', arg = ''] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'board' || name === 'people' || name === 'feed') return { name, arg: '' };
  if (name === 'list' && arg) return { name, arg: decodeURIComponent(arg) };
  return { name: 'my', arg: '' };
}

function go(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
}

// ---------- Каркас приложения ----------

const NAV: { v: RouteName; ic: string; label: string }[] = [
  { v: 'my', ic: '◎', label: 'Мои задачи' },
  { v: 'board', ic: '▤', label: 'Доска' },
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
        <div class="foot"><span id="me-av"></span><span class="nm">${esc(s.me.name)}</span><button class="btn" id="signout">Выйти</button></div>
      </aside>
      <div class="pane">
        <div class="bar" id="bar"></div>
        <div class="body" id="body"></div>
      </div>
    </div>`;
  app.querySelector('#nav')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]');
    if (b) go('#/' + b.dataset.v);
  });
  app.querySelector('#signout')!.addEventListener('click', () => signOut());

  // Общие действия во всех видах: создать задачу, открыть задачу по клику
  app.querySelector('.pane')!.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-act=add]')) {
      openTaskForm();
      return;
    }
    const card = t.closest<HTMLElement>('.t-card[data-id], .row[data-id]');
    if (card && !t.closest('.chk')) openTaskForm(card.dataset.id);
  });
}

function renderNav(route: Route): void {
  const s = getSession()!;
  const tasks = getTasks();
  const nMembers = getMembers().length;
  app.querySelectorAll<HTMLButtonElement>('#nav button').forEach((b) =>
    b.setAttribute('aria-current', String(b.dataset.v === route.name)),
  );
  const loaded = isLoaded();
  const set = (id: string, text: string) => {
    const el = app.querySelector('#' + id);
    if (el) el.textContent = loaded ? text : '';
  };
  set('c-my', String(tasks.filter((t) => t.assignees.includes(s.uid) && t.status !== 'done').length));
  set('c-board', String(tasks.length));
  set('c-people', String(nMembers));
  set('ws-sub', pl(nMembers, 'участник', 'участника', 'участников'));
  app.querySelector('#me-av')!.innerHTML = avatarHtml(s.uid);
}

function viewFor(route: Route): ViewResult {
  switch (route.name) {
    case 'board':
      return viewBoard();
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
  const v = viewFor(route);
  bar.innerHTML = v.bar;
  body.innerHTML = v.body;
  v.mount?.(app.querySelector<HTMLElement>('.pane')!);
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
window.addEventListener('hashchange', render);

// ---------- Вход и выход ----------

async function onSignedIn(user: User): Promise<void> {
  renderLoading('Открываем пространство…');
  try {
    await openSession(user);
  } catch (e) {
    console.error('Не удалось открыть пространство', e);
    const code = (e as { code?: string }).code;
    renderSessionError(
      user,
      code === 'permission-denied'
        ? 'Нет доступа к данным: проверьте, что правила Firestore опубликованы.'
        : 'Не удалось открыть пространство. Проверьте связь и обновите страницу.',
    );
    return;
  }
  renderShell();
  startLive();
  render();
}

async function startDemoMode(): Promise<void> {
  const d = await import('./demo');
  startDemo({ workspace: d.demoWorkspace, members: d.demoMembers, tasks: d.demoTasks, uid: d.DEMO_UID });
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
