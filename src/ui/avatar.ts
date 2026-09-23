// Аватар участника — кружок с инициалами, как в макете
import { initials } from '../auth';
import { getMember } from '../store';
import { color as fixColor, esc } from './dom';

export function avatarHtml(uid: string): string {
  const m = getMember(uid);
  const name = m?.name ?? 'Неизвестный';
  const color = fixColor(m?.color ?? '#657083');
  return `<span class="av-s" style="background:${esc(color)}" title="${esc(name)}">${esc(initials(name))}</span>`;
}

/** Несколько аватаров в ряд. */
export function avatarsHtml(uids: string[]): string {
  return `<span class="who">${uids.map(avatarHtml).join('')}</span>`;
}
