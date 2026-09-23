// «Люди»: участники, роль, активные и просроченные задачи, полоска нагрузки — как в макете
import { getMembers, getTasks, isDone, type Role } from '../store';
import { avatarHtml } from '../ui/avatar';
import { esc, pl } from '../ui/dom';
import { isOverdue } from '../ui/pills';
import type { ViewResult } from './types';

export const ROLE_TITLES: Record<Role, string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  member: 'Участник',
  commenter: 'Комментатор',
  viewer: 'Читатель',
};

const ROLE_ORDER: Role[] = ['owner', 'admin', 'member', 'commenter', 'viewer'];

export function viewPeople(): ViewResult {
  const tasks = getTasks();
  const members = getMembers().sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name, 'ru'),
  );
  const rows = members
    .map((m) => {
      const active = tasks.filter((t) => t.assignees.includes(m.uid) && !isDone(t));
      const late = active.filter(isOverdue).length;
      const load = Math.min(100, active.length * 28);
      return `<div class="prow" data-uid="${esc(m.uid)}">${avatarHtml(m.uid)}
        <span><span class="nm">${esc(m.name)}</span> <span class="em">${
          active.length ? pl(active.length, 'активная задача', 'активные задачи', 'активных задач') : 'нет активных задач'
        }${late ? ' · ' + late + ' просрочено' : ''}</span></span>
        <span class="hide-s"><span class="load"><i style="width:${load}%;background:${late ? 'var(--bad)' : 'var(--accent)'}"></i></span></span>
        <span class="hide-s"><span class="pill">${ROLE_TITLES[m.role] ?? esc(m.role)}</span></span>
      </div>`;
    })
    .join('');
  return {
    bar: `<h3>Люди</h3><span class="pill">${pl(members.length, 'участник', 'участника', 'участников')}</span>`,
    body: `<div class="people">${rows}</div>`,
  };
}
