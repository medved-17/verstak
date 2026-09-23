// Текст событий ленты и истории задачи. Формулировки без рода: «Анна: статус …»
import { getMember, statusName, type ActivityEvent } from '../store';
import { esc } from './dom';

function fmtDue(v?: string): string {
  if (!v) return 'без срока';
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}

function names(uids?: string): string {
  if (!uids) return 'никто';
  return uids
    .split(',')
    .filter(Boolean)
    .map((u) => getMember(u)?.name.split(/\s+/)[0] ?? 'кто-то')
    .join(', ') || 'никто';
}

/** Что произошло — без имени задачи (для истории внутри карточки). */
export function eventWhat(e: ActivityEvent): string {
  switch (e.verb) {
    case 'created':
      return 'задача создана';
    case 'status':
      return `статус: ${esc(statusName(e.from ?? ''))} → ${esc(statusName(e.to ?? ''))}`;
    case 'assigned':
      return `исполнители: ${esc(names(e.to))}`;
    case 'due':
      return `срок: ${esc(fmtDue(e.from))} → ${esc(fmtDue(e.to))}`;
    default:
      return esc(e.verb);
  }
}

export function actorName(e: ActivityEvent): string {
  return esc(getMember(e.actor)?.name ?? 'Бывший участник');
}

/** Время как в макете: «сегодня, 12:40», «вчера, 18:02», «21 сентября». */
export function eventTime(at: Date | null): string {
  if (!at) return 'только что';
  const now = new Date();
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(at)) / 86400000);
  const hm = at.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `сегодня, ${hm}`;
  if (diff === 1) return `вчера, ${hm}`;
  return at.toLocaleDateString('ru', { day: 'numeric', month: 'long' });
}
