// Общий список и сохранённые виды: фильтры, поиск, группировка, сортировка.
// Всё считается по данным стора в памяти, без запросов.
import {
  can,
  createView,
  deleteView,
  getAllTags,
  getMember,
  getMembers,
  getSession,
  getTasks,
  getView,
  updateView,
  type SavedView,
  type Task,
  type ViewFilter,
  type ViewInput,
} from '../store';
import { addButton, esc, pl } from '../ui/dom';
import { openModal } from '../ui/modal';
import { isOverdue } from '../ui/pills';
import { taskRowHtml } from '../ui/task-row';
import { toast, writeErrorText } from '../ui/toast';
import type { ViewResult } from './types';

/** Фильтры на экране. who: '' — все, 'none' — без исполнителя, иначе uid. */
export interface Filters {
  q: string;
  who: string;
  tag: string;
  status: string;
  priority: 0 | 1 | 2 | 3;
  overdue: boolean;
  group: SavedView['group'];
  sort: SavedView['sort'];
}

const EMPTY: Filters = { q: '', who: '', tag: '', status: '', priority: 0, overdue: false, group: 'none', sort: 'due' };

export const ALL = 'all';

// Фильтры каждого вида живут в памяти, пока открыта вкладка
const filtersByView = new Map<string, Filters>();

// ---------- фильтр вида ----------

export function toViewFilter(f: Filters): ViewFilter {
  return {
    status: f.status ? [f.status] : [],
    assignees: f.who && f.who !== 'none' ? [f.who] : [],
    unassigned: f.who === 'none',
    tags: f.tag ? [f.tag] : [],
    priority: f.priority ? [f.priority] : [],
    overdue: f.overdue,
  };
}

function fromView(v: SavedView): Filters {
  const f = v.filter;
  return {
    q: '',
    who: f.unassigned ? 'none' : (f.assignees?.[0] ?? ''),
    tag: f.tags?.[0] ?? '',
    status: f.status?.[0] ?? '',
    priority: (f.priority?.[0] ?? 0) as Filters['priority'],
    overdue: !!f.overdue,
    group: v.group,
    sort: v.sort,
  };
}

/** Подходит ли задача под фильтр вида (массивы — «любое из»). */
export function matchesView(t: Task, f: ViewFilter): boolean {
  return (
    (!f.status?.length || f.status.includes(t.status)) &&
    (!f.assignees?.length || f.assignees.some((u) => t.assignees.includes(u))) &&
    (!f.unassigned || !t.assignees.length) &&
    (!f.tags?.length || f.tags.some((g) => t.tags.includes(g))) &&
    (!f.priority?.length || f.priority.includes(t.priority)) &&
    (!f.overdue || isOverdue(t))
  );
}

export function countForView(v: SavedView): number {
  return getTasks().filter((t) => matchesView(t, v.filter)).length;
}

const norm = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е');

export function applyFilters(list: Task[], f: Filters): Task[] {
  const q = norm(f.q.trim());
  const vf = toViewFilter(f);
  return list.filter((t) => (!q || norm(t.title).includes(q)) && matchesView(t, vf));
}

function sameAsSaved(f: Filters, v: SavedView): boolean {
  const a = fromView(v);
  return a.who === f.who && a.tag === f.tag && a.status === f.status && a.priority === f.priority &&
    a.overdue === f.overdue && a.group === f.group && a.sort === f.sort;
}

const noFilters = (f: Filters) =>
  !f.q && !f.who && !f.tag && !f.status && !f.priority && !f.overdue;

// ---------- сортировка и группировка ----------

function sorter(sort: Filters['sort']): (a: Task, b: Task) => number {
  const statuses = getSession()!.workspace.statuses.map((s) => s.key);
  const byDue = (a: Task, b: Task) => (a.due ?? '9999').localeCompare(b.due ?? '9999');
  if (sort === 'order') return (a, b) => statuses.indexOf(a.status) - statuses.indexOf(b.status) || a.order - b.order;
  if (sort === 'priority') return (a, b) => a.priority - b.priority || byDue(a, b) || a.order - b.order;
  return (a, b) => byDue(a, b) || a.order - b.order;
}

function rowsBlock(list: Task[]): string {
  return `<div class="rows">${list.map((t) => taskRowHtml(t, { showNobody: true })).join('')}</div>`;
}

function rowsHtml(f: Filters): string {
  const list = applyFilters(getTasks(), f).sort(sorter(f.sort));
  if (!list.length) return `<div class="empty2">${noFilters(f) ? 'В этом виде задач нет.' : 'Под фильтр ничего не подходит.'}</div>`;
  if (f.group === 'status') {
    return getSession()!.workspace.statuses
      .map((st) => {
        const part = list.filter((t) => t.status === st.key);
        return part.length ? `<div class="grp-h">${esc(st.name)} · ${part.length}</div>${rowsBlock(part)}` : '';
      })
      .join('');
  }
  if (f.group === 'assignee') {
    const people = getMembers().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const groups = people.map((m) => [m.name, list.filter((t) => t.assignees.includes(m.uid))] as const);
    groups.push(['Без исполнителя', list.filter((t) => !t.assignees.length || t.assignees.every((u) => !getMember(u)))]);
    return groups.map(([name, part]) => (part.length ? `<div class="grp-h">${esc(name)} · ${part.length}</div>${rowsBlock(part)}` : '')).join('');
  }
  return rowsBlock(list);
}

// ---------- строка фильтров ----------

function filterBarHtml(f: Filters): string {
  const s = getSession()!;
  const members = getMembers().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const opt = (v: string, label: string, cur: string) =>
    `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
  const pr = String(f.priority);
  return `<div class="fbar" id="fbar">
    <input class="inp inp-s" type="search" id="f-q" placeholder="Поиск по заголовку" value="${esc(f.q)}" autocomplete="off">
    <select class="inp inp-s" id="f-who" aria-label="Человек">
      ${opt('', 'Все люди', f.who)}${opt(s.uid, 'Я', f.who)}${opt('none', 'Без исполнителя', f.who)}
      ${members.filter((m) => m.uid !== s.uid).map((m) => opt(m.uid, m.name, f.who)).join('')}
    </select>
    <select class="inp inp-s" id="f-status" aria-label="Статус">
      ${opt('', 'Все статусы', f.status)}${s.workspace.statuses.map((st) => opt(st.key, st.name, f.status)).join('')}
    </select>
    <select class="inp inp-s" id="f-tag" aria-label="Метка">
      ${opt('', 'Все метки', f.tag)}${getAllTags().map((g) => opt(g, g, f.tag)).join('')}
    </select>
    <select class="inp inp-s" id="f-pr" aria-label="Приоритет">
      ${opt('0', 'Любой приоритет', pr)}${opt('1', 'Высокий', pr)}${opt('2', 'Обычный', pr)}${opt('3', 'Низкий', pr)}
    </select>
    <button type="button" class="chip tagc" id="f-over" aria-pressed="${f.overdue}">Только просроченные</button>
    <button type="button" class="btn" id="f-reset"${noFilters(f) ? ' hidden' : ''}>Сбросить</button>
    <span class="fbar-sp">
      <select class="inp inp-s" id="f-group" aria-label="Группировка">
        ${opt('none', 'Без группировки', f.group)}${opt('status', 'По статусу', f.group)}${opt('assignee', 'По людям', f.group)}
      </select>
      <select class="inp inp-s" id="f-sort" aria-label="Сортировка">
        ${opt('due', 'По сроку', f.sort)}${opt('priority', 'По приоритету', f.sort)}${opt('order', 'Как на доске', f.sort)}
      </select>
    </span>
  </div>`;
}

// ---------- экран ----------

function currentFilters(viewId: string): Filters {
  let f = filtersByView.get(viewId);
  if (!f) {
    const v = getView(viewId);
    f = v ? fromView(v) : { ...EMPTY };
    filtersByView.set(viewId, f);
  }
  return f;
}

function barHtml(viewId: string, f: Filters): string {
  const saved = getView(viewId);
  const n = applyFilters(getTasks(), f).length;
  const dirty = saved ? !sameAsSaved(f, saved) : !noFilters(f) || f.group !== 'none' || f.sort !== 'due';
  const edit = can.editTasks();
  return `<h3>${saved ? `${esc(saved.icon)} ${esc(saved.name)}` : 'Все задачи'}</h3>
    ${saved ? '<span class="pill">сохранённый вид</span>' : ''}
    <span class="pill" id="f-count">${pl(n, 'задача', 'задачи', 'задач')}</span>
    <span class="sp">
      ${edit && saved && dirty ? '<button class="btn" data-view-act="update">Сохранить изменения</button>' : ''}
      ${edit && dirty ? '<button class="btn" data-view-act="save">Сохранить как вид</button>' : ''}
      ${edit && saved ? '<button class="btn" data-view-act="delete">Удалить вид</button>' : ''}
      ${addButton()}
    </span>`;
}

export function viewList(viewId: string): ViewResult {
  if (viewId !== ALL && !getView(viewId)) {
    return {
      bar: '<h3>Вид не найден</h3>',
      body: '<div class="empty2">Этот вид удалили. <a href="#/list/all">Все задачи</a></div>',
    };
  }
  const f = currentFilters(viewId);
  return {
    bar: barHtml(viewId, f),
    body: `${filterBarHtml(f)}<div id="list-rows">${rowsHtml(f)}</div>`,
    mount: (pane) => mountList(pane, viewId),
  };
}

/** Фильтры перерисовывают только строки и шапку — поле поиска не теряет фокус. */
function mountList(pane: HTMLElement, viewId: string): void {
  const fbar = pane.querySelector<HTMLElement>('#fbar');
  const bar = pane.querySelector<HTMLElement>('#bar');
  if (!fbar || !bar) return;

  const update = (patch: Partial<Filters>) => {
    const f = { ...currentFilters(viewId), ...patch };
    filtersByView.set(viewId, f);
    pane.querySelector('#list-rows')!.innerHTML = rowsHtml(f);
    bar.innerHTML = barHtml(viewId, f);
    fbar.querySelector<HTMLElement>('#f-over')!.setAttribute('aria-pressed', String(f.overdue));
    fbar.querySelector<HTMLElement>('#f-reset')!.hidden = noFilters(f);
  };

  fbar.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.id === 'f-q') update({ q: el.value });
  });
  fbar.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.id === 'f-who') update({ who: el.value });
    if (el.id === 'f-status') update({ status: el.value });
    if (el.id === 'f-tag') update({ tag: el.value });
    if (el.id === 'f-pr') update({ priority: Number(el.value) as Filters['priority'] });
    if (el.id === 'f-group') update({ group: el.value as Filters['group'] });
    if (el.id === 'f-sort') update({ sort: el.value as Filters['sort'] });
  });
  fbar.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.id === 'f-over') update({ overdue: !currentFilters(viewId).overdue });
    if (el.id === 'f-reset') {
      const cur = currentFilters(viewId);
      filtersByView.set(viewId, { ...EMPTY, group: cur.group, sort: cur.sort });
      fbar.outerHTML = filterBarHtml(currentFilters(viewId));
      mountList(pane, viewId);
      update({});
    }
  });

  // Кнопки видов — в шапке, она перерисовывается, поэтому слушаем через pane один раз
  if (!pane.dataset.viewActs) {
    pane.dataset.viewActs = '1';
    pane.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-view-act]');
      if (!b) return;
      const id = decodeURIComponent(location.hash.split('/')[2] ?? ALL);
      const f = currentFilters(id);
      if (b.dataset.viewAct === 'save') openSaveView(f, id);
      if (b.dataset.viewAct === 'update') {
        updateView(id, { filter: toViewFilter(f), group: f.group, sort: f.sort })
          .then(() => toast('Вид сохранён'))
          .catch((err) => toast(writeErrorText(err), 'bad'));
      }
      if (b.dataset.viewAct === 'delete') openDeleteView(id);
    });
  }
}

const ICONS = ['▦', '!', '○', '#', '★', '◆', '◎', '≡'];

function openSaveView(f: Filters, fromId: string): void {
  const { el, close } = openModal(`
    <form class="tform" novalidate>
      <h3>Сохранить как вид</h3>
      <label class="fld"><span class="k">Название</span>
        <input class="inp" name="name" maxlength="60" required autocomplete="off" placeholder="Например: Горит на неделе">
      </label>
      <div class="fld"><span class="k">Значок</span>
        <div class="chips">${ICONS.map((ic, i) => `<button type="button" class="chip tagc" data-icon="${esc(ic)}" aria-pressed="${i === 0}">${esc(ic)}</button>`).join('')}</div>
      </div>
      <p class="muted">Вид увидят все участники пространства. Поиск по заголовку в вид не сохраняется.</p>
      <p class="err" hidden></p>
      <div class="acts">
        <button type="button" class="btn" data-act="cancel">Отмена</button>
        <button type="submit" class="btn pri">Сохранить</button>
      </div>
    </form>`);
  const form = el.querySelector<HTMLFormElement>('form')!;
  const nameInput = form.querySelector<HTMLInputElement>('[name=name]')!;
  nameInput.focus();
  form.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-act=cancel]')) close();
    const ic = t.closest<HTMLButtonElement>('[data-icon]');
    if (ic) form.querySelectorAll('[data-icon]').forEach((b) => b.setAttribute('aria-pressed', String(b === ic)));
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      const err = form.querySelector<HTMLElement>('.err')!;
      err.textContent = 'Нужно название.';
      err.hidden = false;
      return;
    }
    const icon = form.querySelector<HTMLElement>('[data-icon][aria-pressed=true]')?.dataset.icon ?? ICONS[0];
    const v: ViewInput = { name, icon, filter: toViewFilter(f), group: f.group, sort: f.sort };
    createView(v)
      .then((id) => {
        filtersByView.set(id, { ...f, q: '' });
        // Фильтры перенесены в новый вид — «Все задачи» снова без фильтров
        if (fromId === ALL) filtersByView.delete(ALL);
        location.hash = '#/list/' + encodeURIComponent(id);
      })
      .catch((err) => toast(writeErrorText(err), 'bad'));
    close();
  });
}

function openDeleteView(id: string): void {
  const v = getView(id);
  if (!v) return;
  const { el, close } = openModal(`
    <form class="tform">
      <h3>Удалить вид «${esc(v.name)}»?</h3>
      <p class="muted">Вид пропадёт у всех участников. Задачи останутся.</p>
      <div class="acts">
        <button type="button" class="btn" data-act="cancel">Отмена</button>
        <button type="submit" class="btn pri">Удалить</button>
      </div>
    </form>`);
  const form = el.querySelector<HTMLFormElement>('form')!;
  form.querySelector<HTMLElement>('[data-act=cancel]')!.focus();
  form.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-act=cancel]')) close();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    deleteView(id)
      .then(() => {
        filtersByView.delete(id);
        location.hash = '#/list/' + ALL;
      })
      .catch((err) => toast(writeErrorText(err), 'bad'));
    close();
  });
}
