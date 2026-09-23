// «Мои задачи»: мои задачи по срокам — просрочено, сегодня и завтра, дальше, сделано
import { can, getSession, getTasks, isDone, type Task } from '../store';
import { addButton, esc } from '../ui/dom';
import { daysFromToday } from '../ui/pills';
import { taskRowHtml } from '../ui/task-row';
import type { ViewResult } from './types';

const byDue = (a: Task, b: Task) =>
  (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.order - b.order;

export function viewMy(): ViewResult {
  const s = getSession()!;
  const mine = getTasks().filter((t) => t.assignees.includes(s.uid));
  const groups: [string, (t: Task) => boolean][] = [
    ['Просрочено', (t) => !isDone(t) && !!t.due && daysFromToday(t.due) < 0],
    ['Сегодня и завтра', (t) => !isDone(t) && !!t.due && daysFromToday(t.due) >= 0 && daysFromToday(t.due) <= 1],
    ['Дальше', (t) => !isDone(t) && (!t.due || daysFromToday(t.due) > 1)],
    ['Сделано', (t) => isDone(t)],
  ];
  const body = groups
    .map(([name, test]) => {
      const list = mine.filter(test).sort(byDue);
      if (!list.length) return '';
      return `<div class="grp-h">${name} · ${list.length}</div><div class="rows">${list.map((t) => taskRowHtml(t)).join('')}</div>`;
    })
    .join('');
  return {
    bar: `<h3>Мои задачи</h3><span class="pill">${esc(s.me.name.split(/\s+/)[0])}</span><span class="sp">${addButton()}</span>`,
    body:
      body ||
      `<div class="empty2">${can.editTasks() ? 'На вас пока нет задач. Создайте первую кнопкой «+ Задача» или клавишей N.' : 'На вас пока нет задач.'}</div>`,
  };
}
