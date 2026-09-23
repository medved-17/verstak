// «Мои задачи» — наполняется в T-10
import { getSession, getTasks } from '../store';
import { addButton, esc } from '../ui/dom';
import type { ViewResult } from './types';

export function viewMy(): ViewResult {
  const s = getSession()!;
  const mine = getTasks().filter((t) => t.assignees.includes(s.uid));
  return {
    bar: `<h3>Мои задачи</h3><span class="pill">${esc(s.me.name.split(/\s+/)[0])}</span><span class="sp">${addButton()}</span>`,
    body: `<div class="empty2">Задач на мне: ${mine.length}. Список по срокам появится в T-10.</div>`,
  };
}
