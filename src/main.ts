// Точка входа. Пока показывает только вход и текущего пользователя;
// маршрутизация по hash появится вместе с экранами.
import './styles.css';
import { authErrorText, initials, signInWithGoogle, signOut, watchUser, type User } from './auth';

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

function renderSignedIn(user: User): void {
  const name = user.displayName || user.email || 'Без имени';
  app.innerHTML = `
    <main class="gate">
      <div class="panel">
        <h1>Верстак</h1>
        <div class="me">
          <span class="av-s" style="background:var(--accent)">${esc(initials(name))}</span>
          <span><span class="nm" id="me-name">${esc(name)}</span><br><span class="em" id="me-email">${esc(user.email ?? '')}</span></span>
        </div>
        <button class="btn" id="signout">Выйти</button>
      </div>
    </main>`;
  app.querySelector('#signout')!.addEventListener('click', () => signOut());
}

renderLoading();
watchUser((user) => (user ? renderSignedIn(user) : renderSignedOut()));
