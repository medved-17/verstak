// Строка задачи в списках — разметка из макета
import { can, isDone, type Task } from '../store';
import { avatarsHtml } from './avatar';
import { esc } from './dom';
import { duePill, statusPill } from './pills';

export function taskRowHtml(t: Task, opts: { showNobody?: boolean } = {}): string {
  const done = isDone(t);
  const who = t.assignees.length
    ? avatarsHtml(t.assignees)
    : opts.showNobody
      ? '<span class="pill">никто</span>'
      : '<span></span>';
  return `<div class="row" data-id="${esc(t.id)}">
    <button class="chk" data-id="${esc(t.id)}" data-on="${done ? 1 : 0}" aria-pressed="${done}" aria-label="${done ? 'Снять отметку' : 'Отметить сделанной'}"${can.moveTask(t) ? '' : ' disabled'}>✓</button>
    <span class="nm${done ? ' done' : ''}">${esc(t.title)}${t.tags.length ? `<span class="sub">${esc(t.tags[0])}</span>` : ''}</span>
    ${statusPill(t)}
    ${duePill(t) || '<span></span>'}
    <span>${who}</span>
  </div>`;
}
