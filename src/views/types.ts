// Общий вид экрана: шапка (.bar) и содержимое (.body)
export interface ViewResult {
  bar: string;
  body: string;
  /** Навесить обработчики после вставки разметки. */
  mount?: (pane: HTMLElement) => void;
}
