// Короткое уведомление внизу экрана
let current: HTMLElement | null = null;
let timer = 0;

export function toast(text: string, kind: 'info' | 'bad' = 'info'): void {
  current?.remove();
  clearTimeout(timer);
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'bad' ? ' bad' : '');
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  current = el;
  timer = window.setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3000);
}

/** Текст ошибки записи в Firestore для человека. */
export function writeErrorText(e: unknown): string {
  const code = (e as { code?: string }).code;
  if (code === 'permission-denied') return 'Нет прав на это действие.';
  return 'Не удалось сохранить. Проверьте связь — изменение отправится, когда она появится.';
}
