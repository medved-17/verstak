// Мелкие помощники для сборки разметки строками

/** Экранирование текста для вставки в HTML. */
export const esc = (t: string): string =>
  t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Склонение: pl(5, 'задача', 'задачи', 'задач') → «5 задач». */
export function pl(n: number, one: string, few: string, many: string): string {
  const m = n % 100;
  const k = n % 10;
  return n + ' ' + (m >= 11 && m <= 14 ? many : k === 1 ? one : k >= 2 && k <= 4 ? few : many);
}

/** Кнопка «+ Задача» из шапки макета; обработчик — общий, в main.ts. */
export function addButton(): string {
  return '<button class="btn pri" data-act="add">+ Задача</button>';
}
