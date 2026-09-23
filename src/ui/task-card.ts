// Карточка задачи на доске — разметка из макета
import type { Task } from '../store';
import { avatarsHtml } from './avatar';
import { esc } from './dom';
import { duePill, priorityPill, tagPill } from './pills';

export function taskCardHtml(t: Task): string {
  return `<div class="t-card" draggable="true" data-id="${esc(t.id)}">
    <div class="ttl">${esc(t.title)}</div>
    <div class="meta">${priorityPill(t)}${tagPill(t)}${duePill(t)}${avatarsHtml(t.assignees)}</div>
  </div>`;
}
