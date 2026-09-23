// Общий список с фильтрами и поиском. Всё считается по данным стора, без запросов.
import { getAllTags, getMembers, getSession, getTasks, type Task } from '../store';
import { addButton, esc, pl } from '../ui/dom';
import { isOverdue } from '../ui/pills';
import { taskRowHtml } from '../ui/task-row';
import type { ViewResult } from './types';

/** Текущие фильтры списка. who: '' — все, 'none' — без исполнителя, иначе uid. */
export interface Filters {
  q: string;
  who: string;
  tag: string;
  priority: 0 | 1 | 2 | 3;
  overdue: boolean;
}

const EMPTY: Filters = { q: '', who: '', tag: '', priority: 0, overdue: false };

// Фильтры живут в памяти, пока открыта вкладка; сохранённые виды — T-18
let filters: Filters = { ...EMPTY };

export function getFilters(): Filters {
  return { ...filters };
}

const norm = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е');

export function applyFilters(list: Task[], f: Filters): Task[] {
  const q = norm(f.q.trim());
  return list.filter(
    (t) =>
      (!q || norm(t.title).includes(q)) &&
      (!f.who || (f.who === 'none' ? !t.assignees.length : t.assignees.includes(f.who))) &&
      (!f.tag || t.tags.includes(f.tag)) &&
      (!f.priority || t.priority === f.priority) &&
      (!f.overdue || isOverdue(t)),
  );
}

const isEmpty = (f: Filters) => JSON.stringify(f) === JSON.stringify(EMPTY);

function sortList(list: Task[]): Task[] {
  // По сроку, без срока — в конце; внутри — порядок доски
  return list.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.order - b.order);
}

function rowsHtml(): string {
  const list = sortList(applyFilters(getTasks(), filters));
  return list.length
    ? `<div class="rows">${list.map((t) => taskRowHtml(t, { showNobody: true })).join('')}</div>`
    : `<div class="empty2">${isEmpty(filters) ? 'В этом виде задач нет.' : 'Под фильтр ничего не подходит.'}</div>`;
}

function countText(): string {
  const n = applyFilters(getTasks(), filters).length;
  return pl(n, 'задача', 'задачи', 'задач');
}

function filterBarHtml(): string {
  const s = getSession()!;
  const members = getMembers().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const opt = (v: string, label: string, cur: string) =>
    `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
  return `<div class="fbar" id="fbar">
    <input class="inp inp-s" type="search" id="f-q" placeholder="Поиск по заголовку" value="${esc(filters.q)}" autocomplete="off">
    <select class="inp inp-s" id="f-who" aria-label="Человек">
      ${opt('', 'Все люди', filters.who)}${opt(s.uid, 'Я', filters.who)}${opt('none', 'Без исполнителя', filters.who)}
      ${members.filter((m) => m.uid !== s.uid).map((m) => opt(m.uid, m.name, filters.who)).join('')}
    </select>
    <select class="inp inp-s" id="f-tag" aria-label="Метка">
      ${opt('', 'Все метки', filters.tag)}${getAllTags().map((g) => opt(g, g, filters.tag)).join('')}
    </select>
    <select class="inp inp-s" id="f-pr" aria-label="Приоритет">
      ${opt('0', 'Любой приоритет', String(filters.priority))}${opt('1', 'Высокий', String(filters.priority))}${opt('2', 'Обычный', String(filters.priority))}${opt('3', 'Низкий', String(filters.priority))}
    </select>
    <button type="button" class="chip tagc" id="f-over" aria-pressed="${filters.overdue}">Только просроченные</button>
    <button type="button" class="btn" id="f-reset"${isEmpty(filters) ? ' hidden' : ''}>Сбросить</button>
  </div>`;
}

export function viewList(viewId: string): ViewResult {
  const title = viewId === 'all' ? 'Все задачи' : 'Вид';
  return {
    bar: `<h3>${esc(title)}</h3><span class="pill" id="f-count">${countText()}</span><span class="sp">${addButton()}</span>`,
    body: `${filterBarHtml()}<div id="list-rows">${rowsHtml()}</div>`,
    mount: mountFilters,
  };
}

/** Фильтры перерисовывают только строки — поле поиска не теряет фокус и курсор. */
function mountFilters(pane: HTMLElement): void {
  const bar = pane.querySelector<HTMLElement>('#fbar');
  if (!bar) return;
  const update = (patch: Partial<Filters>) => {
    filters = { ...filters, ...patch };
    pane.querySelector('#list-rows')!.innerHTML = rowsHtml();
    pane.querySelector('#f-count')!.textContent = countText();
    bar.querySelector<HTMLElement>('#f-over')!.setAttribute('aria-pressed', String(filters.overdue));
    bar.querySelector<HTMLElement>('#f-reset')!.hidden = isEmpty(filters);
  };
  bar.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.id === 'f-q') update({ q: el.value });
  });
  bar.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.id === 'f-who') update({ who: el.value });
    if (el.id === 'f-tag') update({ tag: el.value });
    if (el.id === 'f-pr') update({ priority: Number(el.value) as Filters['priority'] });
  });
  bar.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.id === 'f-over') update({ overdue: !filters.overdue });
    if (el.id === 'f-reset') {
      filters = { ...EMPTY };
      bar.outerHTML = filterBarHtml();
      mountFilters(pane);
      update({});
    }
  });
}
