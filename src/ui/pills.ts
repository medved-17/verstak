// Пилюли: срок, приоритет, метка, статус — как в макете
import type { Task } from '../store';
import { esc } from './dom';

/** Сегодня в формате 'YYYY-MM-DD' по местному времени. */
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Сколько дней от сегодня до даты: <0 — прошла, 0 — сегодня. */
export function daysFromToday(due: string): number {
  const [y, m, d] = due.split('-').map(Number);
  const [ty, tm, td] = todayKey().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

export function isOverdue(t: Task): boolean {
  return t.status !== 'done' && !!t.due && daysFromToday(t.due) < 0;
}

/** Подпись срока: «просрочено», «сегодня», «завтра» или «2 окт.». */
export function dueLabel(t: Task): string {
  if (!t.due) return '';
  const dd = daysFromToday(t.due);
  if (dd < 0 && t.status !== 'done') return 'просрочено';
  if (dd === 0) return 'сегодня';
  if (dd === 1) return 'завтра';
  const [y, m, d] = t.due.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}

/** Класс пилюли срока: late — просрочено, due — сегодня или завтра. У сделанных задач срок не горит. */
export function dueClass(t: Task): string {
  if (!t.due || t.status === 'done') return '';
  const dd = daysFromToday(t.due);
  return dd < 0 ? 'late' : dd <= 1 ? 'due' : '';
}

export function duePill(t: Task): string {
  return t.due ? `<span class="pill ${dueClass(t)}">${esc(dueLabel(t))}</span>` : '';
}

export function priorityPill(t: Task): string {
  return t.priority === 1 ? '<span class="pill p1">высокий</span>' : '';
}

/** На карточке — первая метка, как в макете. */
export function tagPill(t: Task): string {
  return t.tags.length ? `<span class="pill">${esc(t.tags[0])}</span>` : '';
}
