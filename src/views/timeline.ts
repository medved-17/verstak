// Шкала сроков: люди по строкам, дни по столбцам, задачи — точками в день срока.
// Задачи без срока — серыми точками в последнем столбце, чтобы на шкале были видны все открытые.
// Клик по пустой клетке — новая задача на этот день и этого человека.
// Считается по задачам из стора, без запросов. Сделанные не показываются.
import { can, getMembers, getSession, getTasks, isDone, type Task } from '../store';
import { avatarHtml } from '../ui/avatar';
import { esc } from '../ui/dom';
import { daysFromToday, dueClass } from '../ui/pills';
import type { ViewResult } from './types';

const DAYS = 21; // сегодня и три недели вперёд

const ROLE_ORDER = ['owner', 'admin', 'member', 'commenter', 'viewer'];

const NO_DUE = DAYS + 2;

/** Столбец задачи: 0 — просрочено, 1…DAYS — день от сегодня, DAYS+1 — позже, DAYS+2 — без срока. */
function columnOf(t: Task): number {
  if (!t.due) return NO_DUE;
  const dd = daysFromToday(t.due);
  if (dd < 0) return 0;
  if (dd >= DAYS) return DAYS + 1;
  return dd + 1;
}

function dotHtml(t: Task): string {
  const cls = t.due ? dueClass(t) || 'far' : 'none';
  const label = t.due ? `${t.title} — срок ${t.due.split('-').reverse().join('.')}` : `${t.title} — без срока`;
  return `<button class="tl-dot ${cls}" data-id="${esc(t.id)}" title="${esc(label)}" aria-label="${esc(label)}"></button>`;
}

function cellHtml(list: Task[], col: number, extra = '', add = ''): string {
  // Больше четырёх точек в клетке — показываем три и число остальных
  const shown = list.length > 4 ? list.slice(0, 3) : list;
  const more = list.length - shown.length;
  return `<div class="tl-c${extra}" data-col="${col}"${add}>${shown.map(dotHtml).join('')}${more ? `<span class="tl-more">+${more}</span>` : ''}</div>`;
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function viewTimeline(): ViewResult {
  const s = getSession()!;
  const active = getTasks().filter((t) => !isDone(t));
  const canAdd = can.editTasks();

  // Дни шкалы
  const today = new Date();
  const days = Array.from({ length: DAYS }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  const dayCls = (d: Date, i: number) =>
    (i === 0 ? ' today' : '') + (d.getDay() === 0 || d.getDay() === 6 ? ' wknd' : '');

  const head =
    '<div class="tl-h tl-name"></div>' +
    '<div class="tl-h tl-edge late" title="Просрочено">проср.</div>' +
    days
      .map((d, i) => {
        const month = i === 0 || d.getDate() === 1 ? d.toLocaleDateString('ru', { month: 'short' }).replace('.', '') : '';
        return `<div class="tl-h${dayCls(d, i)}" title="${d.toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' })}">
          <span class="tl-m">${month}</span><span class="tl-d">${d.getDate()}</span><span class="tl-w">${d.toLocaleDateString('ru', { weekday: 'short' })}</span>
        </div>`;
      })
      .join('') +
    '<div class="tl-h tl-edge" title="Позже трёх недель">позже</div>' +
    '<div class="tl-h tl-edge" title="Задачи без срока">без срока</div>';

  // Строки: участники по роли и имени, затем «Без исполнителя»
  const people = getMembers().sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name, 'ru'),
  );
  const rows: { label: string; list: Task[]; uid: string; me?: boolean }[] = people.map((m) => ({
    label: `${avatarHtml(m.uid)}<span class="tl-nm">${esc(m.name.split(/\s+/)[0])}</span>`,
    list: active.filter((t) => t.assignees.includes(m.uid)),
    uid: m.uid,
    me: m.uid === s.uid,
  }));
  const nobody = active.filter((t) => !t.assignees.length);
  if (nobody.length) rows.push({ label: '<span class="tl-nobody">○</span><span class="tl-nm">Без исполнителя</span>', list: nobody, uid: '' });

  const body = rows
    .map((r) => {
      const byCol = new Map<number, Task[]>();
      r.list.forEach((t) => {
        const c = columnOf(t);
        byCol.set(c, [...(byCol.get(c) ?? []), t]);
      });
      // Клетка дня — место для новой задачи: этот день и этот человек
      const add = (d: Date) =>
        canAdd ? ` data-due="${dayKey(d)}" data-uid="${esc(r.uid)}" title="Новая задача на ${d.toLocaleDateString('ru', { day: 'numeric', month: 'long' })}"` : '';
      const cells = [
        cellHtml(byCol.get(0) ?? [], 0, ' tl-edge'),
        ...days.map((d, i) => cellHtml(byCol.get(i + 1) ?? [], i + 1, dayCls(d, i), add(d))),
        cellHtml(byCol.get(DAYS + 1) ?? [], DAYS + 1, ' tl-edge'),
        cellHtml(byCol.get(NO_DUE) ?? [], NO_DUE, ' tl-edge'),
      ].join('');
      return `<div class="tl-c tl-name${r.me ? ' me' : ''}">${r.label}</div>${cells}`;
    })
    .join('');

  const noDue = active.filter((t) => !t.due).length;
  const hint = !active.length
    ? canAdd ? 'Открытых задач нет. Нажмите на клетку дня, чтобы поставить задачу на этот день.' : 'Открытых задач нет.'
    : noDue === active.length
      ? 'У задач пока нет срока — они в столбце «без срока». Откройте задачу точкой и поставьте срок, и она встанет на свой день.'
      : canAdd ? 'Нажмите на пустую клетку, чтобы поставить новую задачу на этот день и этого человека.' : '';
  return {
    bar: `<h3>Шкала сроков</h3><span class="pill">3 недели</span>
      <span class="sp tl-legend"><span><i class="tl-dot late"></i>просрочено</span><span><i class="tl-dot due"></i>сегодня и завтра</span><span><i class="tl-dot far"></i>дальше</span><span><i class="tl-dot none"></i>без срока</span></span>`,
    body: `<div class="tl-wrap"><div class="tl" style="--days:${DAYS}">${head}${body}</div></div>
      ${hint ? `<p class="muted tl-note">${hint}</p>` : ''}`,
  };
}
