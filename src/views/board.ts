// Доска: колонки из статусов пространства, карточки по полю order
import { getSession, getTasks, moveTask, type Task } from '../store';
import { addButton, color, esc } from '../ui/dom';
import { taskCardHtml } from '../ui/task-card';
import { toast, writeErrorText } from '../ui/toast';
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
        <div class="ch"><span class="dot" style="background:${esc(color(c.color))}"></span>${esc(c.name)}<span class="n">${list.length}</span></div>
        ${list.length ? list.map(taskCardHtml).join('') : '<div class="col-empty">Пусто</div>'}
      </div>`;
    })
    .join('');
  return {
    bar: `<h3>Доска</h3><span class="sp">${addButton()}</span>`,
    body: `<div class="kanban">${cols}</div>`,
    mount: mountDrag,
  };
}

/** Перетаскивание карточек между колонками и внутри колонки. */
function mountDrag(pane: HTMLElement): void {
  const kanban = pane.querySelector<HTMLElement>('.kanban');
  if (!kanban) return;
  let dragId: string | null = null;
  let dropIndex = 0;
  const line = document.createElement('div');
  line.className = 'drop-line';

  const clearMarks = () => {
    kanban.querySelectorAll('.col.over').forEach((c) => c.classList.remove('over'));
    line.remove();
  };

  kanban.addEventListener('dragstart', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.t-card');
    if (!card || !e.dataTransfer) return;
    dragId = card.dataset.id!;
    card.classList.add('drag');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });

  kanban.addEventListener('dragend', () => {
    kanban.querySelectorAll('.t-card.drag').forEach((c) => c.classList.remove('drag'));
    clearMarks();
    dragId = null;
  });

  kanban.addEventListener('dragover', (e) => {
    const col = (e.target as HTMLElement).closest<HTMLElement>('.col');
    if (!col || !dragId) return;
    e.preventDefault();
    if (!col.classList.contains('over')) {
      clearMarks();
      col.classList.add('over');
    }
    // Место вставки — перед первой карточкой, чья середина ниже курсора
    const cards = [...col.querySelectorAll<HTMLElement>('.t-card:not(.drag)')];
    const i = cards.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    dropIndex = i === -1 ? cards.length : i;
    const anchor = cards[dropIndex];
    if (anchor) {
      if (line.nextElementSibling !== anchor) col.insertBefore(line, anchor);
    } else if (col.lastElementChild !== line) {
      col.append(line);
    }
  });

  kanban.addEventListener('dragleave', (e) => {
    const col = (e.target as HTMLElement).closest('.col');
    if (col && !col.contains(e.relatedTarget as Node)) {
      col.classList.remove('over');
      line.remove();
    }
  });

  kanban.addEventListener('drop', (e) => {
    const col = (e.target as HTMLElement).closest<HTMLElement>('.col');
    if (!col || !dragId) return;
    e.preventDefault();
    const id = dragId;
    clearMarks();
    const res = moveTask(id, col.dataset.col!, dropIndex);
    if (res) {
      res.catch((err) => {
        console.error('Перенос не сохранился', err);
        toast(writeErrorText(err), 'bad');
      });
    }
  });
}
