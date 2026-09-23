// Лента: последние 50 событий — создание, смена статуса, назначение, перенос срока
import { getFeed, getFeedState, getSession, getTask, startFeed } from '../store';
import { actorName, eventTime, eventWhat } from '../ui/activity';
import { avatarHtml } from '../ui/avatar';
import { esc } from '../ui/dom';
import type { ViewResult } from './types';

// «Только мои» — мои действия и события по задачам, где я исполнитель. Локальный фильтр.
let onlyMine = false;

export function viewFeed(): ViewResult {
  startFeed();
  const s = getSession()!;
  const state = getFeedState();
  const list = getFeed().filter(
    (e) => !onlyMine || e.actor === s.uid || !!getTask(e.taskId)?.assignees.includes(s.uid),
  );
  const body =
    state === 'error'
      ? '<p class="err">Ленту не удалось загрузить. Обновите страницу.</p>'
      : state !== 'ready'
        ? '<div class="empty2">Загрузка…</div>'
        : list.length
          ? `<div class="feed">${list
              .map(
                (e) => `<div class="fitem"${getTask(e.taskId) ? ` data-task="${esc(e.taskId)}"` : ''}>${avatarHtml(e.actor)}
                  <span>${actorName(e)}: ${eventWhat(e)} <b>${esc(getTask(e.taskId)?.title ?? e.taskTitle)}</b><span class="tm">${eventTime(e.at)}</span></span></div>`,
              )
              .join('')}</div>`
          : `<div class="empty2">${onlyMine ? 'Событий по вашим задачам пока нет.' : 'Событий пока нет.'}</div>`;
  return {
    bar: `<h3>Лента</h3><span class="sp"><span class="seg" id="feed-seg"><button aria-pressed="${!onlyMine}" data-mine="0">Все</button><button aria-pressed="${onlyMine}" data-mine="1">Только мои</button></span></span>`,
    body,
    mount: (pane) => {
      pane.querySelector('#feed-seg')?.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mine]');
        if (!b) return;
        onlyMine = b.dataset.mine === '1';
        // Перерисовать текущий вид — тем же путём, что и при смене адреса
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    },
  };
}
