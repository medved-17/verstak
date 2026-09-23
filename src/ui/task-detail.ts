// Карточка задачи: открывается по клику, правки сохраняются сами.
// Текст (заголовок, описание) копится и уходит одной записью через 2 секунды после
// последнего ввода; выпадающие списки пишутся сразу; чипы — через секунду после последнего
// клика, чтобы несколько щелчков дали одну запись. При закрытии несохранённое уходит сразу.
import {
  addComment,
  can,
  COMMENT_MAX,
  DESCR_MAX,
  getAllTags,
  getMember,
  getMembers,
  getSession,
  getTask,
  loadTaskHistory,
  onChange,
  TITLE_MAX,
  updateTask,
  watchComments,
  type Priority,
  type Task,
  type TaskInput,
} from '../store';
import { actorName, eventTime, eventWhat } from './activity';
import { avatarHtml } from './avatar';
import { esc } from './dom';
import { openModal } from './modal';
import { toast, writeErrorText } from './toast';

const TEXT_DELAY = 2000;
const CHIPS_DELAY = 1000;

const PRIORITIES: { v: Priority; n: string }[] = [
  { v: 1, n: 'Высокий' },
  { v: 2, n: 'Обычный' },
  { v: 3, n: 'Низкий' },
];

function chipsHtml(task: Task): { who: string; tags: string } {
  const members = getMembers().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const tags = [...new Set([...getAllTags(), ...task.tags])];
  return {
    who: members
      .map((m) => `<button type="button" class="chip" data-v="${esc(m.uid)}" aria-pressed="${task.assignees.includes(m.uid)}">${avatarHtml(m.uid)}${esc(m.name)}</button>`)
      .join(''),
    tags: tags
      .map((g) => `<button type="button" class="chip tagc" data-v="${esc(g)}" aria-pressed="${task.tags.includes(g)}">${esc(g)}</button>`)
      .join(''),
  };
}

export function openTaskDetail(id: string): void {
  const s = getSession()!;
  const task = getTask(id);
  if (!task) return;
  // Что можно менять: всё (участник и выше), только статус (комментатор, своя задача) или ничего
  const mode: 'full' | 'status' | 'view' = can.editTasks() ? 'full' : can.moveTask(task) ? 'status' : 'view';
  const chips = chipsHtml(task);

  let pending: Partial<TaskInput> = {};
  let timer = 0;
  let unsubscribe: () => void = () => undefined;
  let unwatchComments: () => void = () => undefined;

  const { el, close } = openModal(
    `
    <div class="tform tdetail">
      <div class="td-head">
        <textarea class="inp td-title" name="title" rows="1" maxlength="${TITLE_MAX}" aria-label="Заголовок">${esc(task.title)}</textarea>
        <span class="muted td-save" aria-live="polite"></span>
      </div>
      ${mode === 'status' ? '<p class="muted">Вы можете менять только статус этой задачи.</p>' : mode === 'view' ? '<p class="muted">Только просмотр.</p>' : ''}
      <p class="err" hidden></p>
      <div class="fgrid">
        <label class="fld"><span class="k">Статус</span>
          <select class="inp" name="status">${s.workspace.statuses
            .map((st) => `<option value="${esc(st.key)}"${st.key === task.status ? ' selected' : ''}>${esc(st.name)}</option>`)
            .join('')}</select>
        </label>
        <label class="fld"><span class="k">Срок</span>
          <input class="inp" type="date" name="due" value="${esc(task.due ?? '')}">
        </label>
        <label class="fld"><span class="k">Приоритет</span>
          <select class="inp" name="priority">${PRIORITIES.map((p) => `<option value="${p.v}"${p.v === task.priority ? ' selected' : ''}>${p.n}</option>`).join('')}</select>
        </label>
      </div>
      <div class="fld"><span class="k">Исполнители</span><div class="chips" data-group="assignees">${chips.who}</div></div>
      <div class="fld"><span class="k">Метки</span>
        <div class="chips" data-group="tags">${chips.tags}<input class="inp inp-s" name="newtag" placeholder="+ новая метка" maxlength="40" autocomplete="off"></div>
      </div>
      <label class="fld"><span class="k">Описание</span>
        <textarea class="inp" name="descr" rows="6" maxlength="${DESCR_MAX}" placeholder="${mode === 'full' ? 'Подробности, ссылки, критерии готовности' : ''}">${esc(task.descr)}</textarea>
      </label>
      <div class="fld"><span class="k">Комментарии</span>
        <div class="feed" id="td-comments"><div class="empty2">Загрузка…</div></div>
        ${can.comment() ? `<div class="td-comment">
          <textarea class="inp" name="comment" rows="2" maxlength="${COMMENT_MAX}" placeholder="Написать комментарий… (Ctrl+Enter — отправить)"></textarea>
          <button type="button" class="btn" data-act="comment">Отправить</button>
        </div>` : ''}
      </div>
      <div class="fld"><span class="k">История</span><div class="feed" id="td-history"><div class="empty2">Загрузка…</div></div></div>
      <div class="acts"><button type="button" class="btn" data-act="close">Закрыть</button></div>
    </div>`,
    () => {
      flush();
      unsubscribe();
      unwatchComments();
    },
  );
  el.classList.add('modal-wide');

  const root = el.querySelector<HTMLElement>('.tdetail')!;
  const saveNote = root.querySelector<HTMLElement>('.td-save')!;
  const err = root.querySelector<HTMLElement>('.err')!;
  const titleEl = root.querySelector<HTMLTextAreaElement>('[name=title]')!;
  const descrEl = root.querySelector<HTMLTextAreaElement>('[name=descr]')!;
  const newTag = root.querySelector<HTMLInputElement>('[name=newtag]')!;

  // Права: отключаем всё, что менять нельзя
  if (mode !== 'full') {
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('.inp, .chip').forEach((c) => {
      const name = c.getAttribute('name');
      // Комментарий — отдельное право; статус — у комментатора для своей задачи
      if (name === 'comment' || (mode === 'status' && name === 'status')) return;
      c.disabled = true;
    });
    newTag.hidden = true;
  }

  // Высота заголовка по содержимому
  const fitTitle = () => {
    titleEl.style.height = 'auto';
    titleEl.style.height = titleEl.scrollHeight + 'px';
  };
  fitTitle();

  // ---------- сохранение ----------

  function flush(): void {
    clearTimeout(timer);
    const patch = pending;
    pending = {};
    if (!Object.keys(patch).length) return;
    saveNote.textContent = 'Сохраняется…';
    updateTask(id, patch)
      .then(() => {
        if (!Object.keys(pending).length) saveNote.textContent = 'Сохранено';
      })
      .catch((e) => {
        console.error('Правка задачи не сохранилась', e);
        saveNote.textContent = '';
        toast(writeErrorText(e), 'bad');
      });
  }

  function queue(patch: Partial<TaskInput>, delay: number): void {
    Object.assign(pending, patch);
    clearTimeout(timer);
    if (delay === 0) {
      flush();
      return;
    }
    saveNote.textContent = 'Изменения сохранятся…';
    timer = window.setTimeout(flush, delay);
  }

  const picked = (group: string) =>
    [...root.querySelectorAll<HTMLButtonElement>(`[data-group=${group}] .chip[aria-pressed=true]`)].map((b) => b.dataset.v!);

  root.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (t === titleEl) {
      fitTitle();
      const v = titleEl.value.replace(/\s*\n\s*/g, ' ').trim();
      err.hidden = !!v;
      err.textContent = v ? '' : 'Заголовок не может быть пустым — прежний сохранён.';
      if (v) queue({ title: v }, TEXT_DELAY);
      else delete pending.title;
    }
    if (t === descrEl) queue({ descr: descrEl.value }, TEXT_DELAY);
  });

  // Enter в заголовке — не перенос строки, а переход к описанию
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      descrEl.focus();
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.name === 'status') queue({ status: t.value }, 0);
    if (t.name === 'due') queue({ due: t.value || null }, 0);
    if (t.name === 'priority') queue({ priority: Number(t.value) as Priority }, 0);
  });

  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-act=close]')) {
      close();
      return;
    }
    if (t.closest('[data-act=comment]')) {
      sendComment();
      return;
    }
    const chip = t.closest<HTMLButtonElement>('.chip');
    if (!chip || chip.disabled) return;
    chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
    const group = chip.closest<HTMLElement>('[data-group]')!.dataset.group!;
    if (group === 'assignees') queue({ assignees: picked('assignees') }, CHIPS_DELAY);
    else queue({ tags: picked('tags') }, CHIPS_DELAY);
  });

  newTag.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const g = newTag.value.trim();
    if (!g) return;
    const existing = [...root.querySelectorAll<HTMLButtonElement>('[data-group=tags] .chip')].find((b) => b.dataset.v === g);
    if (existing) existing.setAttribute('aria-pressed', 'true');
    else newTag.insertAdjacentHTML('beforebegin', `<button type="button" class="chip tagc" data-v="${esc(g)}" aria-pressed="true">${esc(g)}</button>`);
    newTag.value = '';
    queue({ tags: picked('tags') }, CHIPS_DELAY);
  });

  // ---------- чужие правки, пока карточка открыта ----------
  // Обновляем поля, которые человек сейчас не трогает

  unsubscribe = onChange(() => {
    const t = getTask(id);
    if (!t) {
      toast('Задачу удалили');
      close();
      return;
    }
    const active = document.activeElement;
    if (!('title' in pending) && active !== titleEl && titleEl.value !== t.title) {
      titleEl.value = t.title;
      fitTitle();
    }
    if (!('descr' in pending) && active !== descrEl && descrEl.value !== t.descr) descrEl.value = t.descr;
    const setVal = (name: string, v: string) => {
      const f = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[name=${name}]`)!;
      if (!(name in pending) && active !== f && f.value !== v) f.value = v;
    };
    setVal('status', t.status);
    setVal('due', t.due ?? '');
    setVal('priority', String(t.priority));
    if (!('assignees' in pending)) {
      root.querySelectorAll<HTMLButtonElement>('[data-group=assignees] .chip').forEach((b) =>
        b.setAttribute('aria-pressed', String(t.assignees.includes(b.dataset.v!))),
      );
    }
    if (!('tags' in pending)) {
      root.querySelectorAll<HTMLButtonElement>('[data-group=tags] .chip').forEach((b) =>
        b.setAttribute('aria-pressed', String(t.tags.includes(b.dataset.v!))),
      );
    }
  });

  // ---------- комментарии ----------

  const commentsEl = root.querySelector<HTMLElement>('#td-comments')!;
  const commentInput = root.querySelector<HTMLTextAreaElement>('[name=comment]');

  function sendComment(): void {
    if (!commentInput) return;
    const text = commentInput.value;
    if (!text.trim()) return;
    commentInput.value = '';
    addComment(id, text).catch((e) => {
      console.error('Комментарий не отправлен', e);
      commentInput.value = text;
      toast(writeErrorText(e), 'bad');
    });
  }

  commentInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendComment();
    }
  });

  unwatchComments = watchComments(
    id,
    (list) => {
      commentsEl.innerHTML = list.length
        ? list
            .map(
              (c) => `<div class="fitem">${avatarHtml(c.author)}<span><b class="td-author">${esc(getMember(c.author)?.name ?? 'Бывший участник')}</b> <span class="td-text">${esc(c.text)}</span><span class="tm">${eventTime(c.at)}</span></span></div>`,
            )
            .join('')
        : '<div class="empty2">Комментариев пока нет.</div>';
    },
    (e) => {
      console.error('Комментарии не загрузились', e);
      commentsEl.innerHTML = '<div class="empty2">Комментарии не удалось загрузить.</div>';
    },
  );

  // ---------- история ----------

  const history = root.querySelector<HTMLElement>('#td-history')!;
  loadTaskHistory(id)
    .then((list) => {
      history.innerHTML = list.length
        ? list
            .map(
              (e) => `<div class="fitem">${avatarHtml(e.actor)}<span>${actorName(e)}: ${eventWhat(e)}<span class="tm">${eventTime(e.at)}</span></span></div>`,
            )
            .join('')
        : '<div class="empty2">Изменений пока нет.</div>';
    })
    .catch((e) => {
      console.error('История не загрузилась', e);
      history.innerHTML = '<div class="empty2">Историю не удалось загрузить.</div>';
    });

  if (mode === 'full') {
    descrEl.focus();
    descrEl.setSelectionRange(descrEl.value.length, descrEl.value.length);
  } else {
    root.querySelector<HTMLElement>(mode === 'status' ? '[name=status]' : '[data-act=close]')!.focus();
  }
}
