// Точка входа. Пока показывает вход, текущего пользователя и его пространство;
// маршрутизация по hash появится вместе с экранами.
import './styles.css';
import { authErrorText, initials, signInWithGoogle, signOut, watchUser, type User } from './auth';
import { clearSession, openSession, probeTasks, type Role, type Session } from './store';

// Отладка из консоли браузера, только при npm run dev: await verstak.probeTasks('<id>')
if (import.meta.env.DEV) Object.assign(window, { verstak: { probeTasks } });

const ROLE_NAMES: Record<Role, string> = {
  owner: 'владелец',
  admin: 'администратор',
  member: 'участник',
  commenter: 'комментатор',
  viewer: 'читатель',
};

const app = document.querySelector<HTMLDivElement>('#app')!;

const esc = (t: string) =>
  t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function renderLoading(): void {
  app.innerHTML = `<main class="gate"><div class="panel"><p class="muted">Загрузка…</p></div></main>`;
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

function renderSignedIn(user: User, session: Session | null, error: string | null = null): void {
  const name = user.displayName || user.email || 'Без имени';
  const ws = session
    ? `<p class="muted" id="me-ws">Пространство «${esc(session.workspace.name)}» · ${ROLE_NAMES[session.me.role]}<br><span class="mono">${esc(session.workspace.id)}</span></p>`
    : error
      ? `<p class="err">${esc(error)}</p>`
      : '<p class="muted">Готовим пространство…</p>';
  app.innerHTML = `
    <main class="gate">
      <div class="panel">
        <h1>Верстак</h1>
        <div class="me">
          <span class="av-s" style="background:${session?.me.color ?? 'var(--accent)'}">${esc(initials(name))}</span>
          <span><span class="nm" id="me-name">${esc(name)}</span><br><span class="em" id="me-email">${esc(user.email ?? '')}</span></span>
        </div>
        ${ws}
        <button class="btn" id="signout">Выйти</button>
      </div>
    </main>`;
  app.querySelector('#signout')!.addEventListener('click', () => signOut());
}

async function onSignedIn(user: User): Promise<void> {
  renderSignedIn(user, null);
  try {
    renderSignedIn(user, await openSession(user));
  } catch (e) {
    console.error('Не удалось открыть пространство', e);
    const code = (e as { code?: string }).code;
    renderSignedIn(
      user,
      null,
      code === 'permission-denied'
        ? 'Нет доступа к данным: проверьте, что правила Firestore опубликованы.'
        : 'Не удалось открыть пространство. Проверьте связь и обновите страницу.',
    );
  }
}

renderLoading();
watchUser((user) => {
  if (user) {
    void onSignedIn(user);
  } else {
    clearSession();
    renderSignedOut();
  }
});
