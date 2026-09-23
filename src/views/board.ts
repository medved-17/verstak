// Доска: колонки из статусов пространства, карточки по полю order
import { getSession, getTasks, type Task } from '../store';
import { addButton, esc } from '../ui/dom';
import { taskCardHtml } from '../ui/task-card';
import type { ViewResult } from './types';

/** Задачи колонки по порядку. Задачи с неизвестным статусом попадают в первую колонку. */
export function columnTasks(statusKey: string): Task[] {
  const statuses = getSession()!.workspace.statuses;
  const known = new Set(statuses.map((s) => s.key));
  const first = statuses[0]?.key;
  return getTasks()
    .filter((t) => t.status === statusKey || (statusKey === first && !known.has(t.status)))
    .sort((a, b) => a.order - b.order);
}

export function viewBoard(): ViewResult {
  const statuses = getSession()!.workspace.statuses;
  const cols = statuses
    .map((c) => {
      const list = columnTasks(c.key);
      return `<div class="col" data-col="${esc(c.key)}">
        <div class="ch"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}<span class="n">${list.length}</span></div>
        ${list.map(taskCardHtml).join('')}
      </div>`;
    })
    .join('');
  return {
    bar: `<h3>Доска</h3><span class="sp">${addButton()}</span>`,
    body: `<div class="kanban">${cols}</div>`,
  };
}
