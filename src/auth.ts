// Вход, выход и текущий пользователь. Роль появится вместе с пространством (T-04).
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

export type { User };

/** Подписка на смену пользователя. Первый вызов приходит после восстановления сессии. */
export function watchUser(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // Если браузер заблокировал всплывающее окно — уходим на страницу входа целиком
    if ((e as { code?: string }).code === 'auth/popup-blocked') {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw e;
  }
}

export function signOut(): Promise<void> {
  return fbSignOut(auth);
}

/** Понятный текст ошибки входа; null — если показывать нечего (человек сам закрыл окно). */
export function authErrorText(e: unknown): string | null {
  const code = (e as { code?: string }).code ?? '';
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return null;
    case 'auth/unauthorized-domain':
      return 'Этот адрес не разрешён для входа. Добавьте домен в Firebase → Authentication → Settings → Authorized domains.';
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed':
      return 'Вход через Google не включён в Firebase → Authentication → Sign-in method.';
    case 'auth/network-request-failed':
      return 'Нет связи с сервером входа. Проверьте интернет и попробуйте ещё раз.';
    default:
      return 'Не удалось войти' + (code ? ` (${code})` : '') + '.';
  }
}

/** Инициалы для аватара: «Никита Мезенев» → «НМ». */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.map((p) => p[0]).join('').slice(0, 2) || '?').toUpperCase();
}
