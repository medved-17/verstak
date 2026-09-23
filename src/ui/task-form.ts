// Окно создания задачи: заголовок, описание, статус, исполнители, срок, приоритет, метки.
// Правка существующей задачи — в карточке (task-detail.ts).
import {
  can,
  createTask,
  DESCR_MAX,
  getAllTags,
  getMembers,
  getSession,
  TITLE_MAX,
  type Priority,
  type TaskInput,
} from '../store';
import { avatarHtml } from './avatar';
import { esc } from './dom';
import { openModal } from './modal';
import { toast, writeErrorText } from './toast';

const PRIORITIES: { v: Priority; n: string }[] = [
  { v: 1, n: 'Высокий' },
  { v: 2, n: 'Обычный' },
  { v: 3, n: 'Низкий' },
];

/** Открыть окно новой задачи; defaults подставляются в пустую форму. */
export function openTaskForm(defaults: Partial<TaskInput> = {}): void {
  if (!can.editTasks()) return;
  const s = getSession()!;
  const v: TaskInput = {
    title: '',
    descr: '',
    status: s.workspace.statuses[0]?.key ?? '',
    assignees: [s.uid],
    due: null,
    priority: 2,
    tags: [],
    ...defaults,
  };

  const members = getMembers().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const tags = [...new Set([...getAllTags(), ...v.tags])];

  const { el, close } = openModal(`
    <form method="dialog" class="tform" novalidate>
      <h3>Новая задача</h3>
      <label class="fld"><span class="k">Заголовок</span>
        <input class="inp" name="title" maxlength="${TITLE_MAX}" required autocomplete="off" value="${esc(v.title)}">
      </label>
      <label class="fld"><span class="k">Описание</span>
        <textarea class="inp" name="descr" maxlength="${DESCR_MAX}" rows="4">${esc(v.descr)}</textarea>
      </label>
      <div class="fgrid">
        <label class="fld"><span class="k">Статус</span>
          <select class="inp" name="status">${s.workspace.statuses
            .map((st) => `<option value="${esc(st.key)}"${st.key === v.status ? ' selected' : ''}>${esc(st.name)}</option>`)
            .join('')}</select>
        </label>
        <label class="fld"><span class="k">Срок</span>
          <input class="inp" type="date" name="due" value="${esc(v.due ?? '')}">
        </label>
        <label class="fld"><span class="k">Приоритет</span>
          <select class="inp" name="priority">${PRIORITIES.map((p) => `<option value="${p.v}"${p.v === v.priority ? ' selected' : ''}>${p.n}</option>`).join('')}</select>
        </label>
      </div>
      <div class="fld"><span class="k">Исполнители</span>
        <div class="chips" data-group="assignees">${members
          .map((m) => `<button type="button" class="chip" data-v="${esc(m.uid)}" aria-pressed="${v.assignees.includes(m.uid)}">${avatarHtml(m.uid)}${esc(m.name)}</button>`)
          .join('')}</div>
      </div>
      <div class="fld"><span class="k">Метки</span>
        <div class="chips" data-group="tags">${tags
          .map((g) => `<button type="button" class="chip tagc" data-v="${esc(g)}" aria-pressed="${v.tags.includes(g)}">${esc(g)}</button>`)
          .join('')}
          <input class="inp inp-s" name="newtag" placeholder="+ новая метка" maxlength="40" autocomplete="off">
        </div>
      </div>
      <p class="err" hidden></p>
      <div class="acts">
        <button type="button" class="btn" data-act="cancel">Отмена</button>
        <button type="submit" class="btn pri">Создать</button>
      </div>
    </form>`);

  const form = el.querySelector<HTMLFormElement>('form')!;
  const err = form.querySelector<HTMLElement>('.err')!;
  const titleInput = form.querySelector<HTMLInputElement>('[name=title]')!;
  const newTag = form.querySelector<HTMLInputElement>('[name=newtag]')!;
  titleInput.focus();

  const addTagChip = (name: string) => {
    const g = name.trim();
    if (!g) return;
    const existing = [...form.querySelectorAll<HTMLButtonElement>('[data-group=tags] .chip')].find((b) => b.dataset.v === g);
    if (existing) existing.setAttribute('aria-pressed', 'true');
    else newTag.insertAdjacentHTML('beforebegin', `<button type="button" class="chip tagc" data-v="${esc(g)}" aria-pressed="true">${esc(g)}</button>`);
    newTag.value = '';
  };

  form.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLButtonElement>('.chip');
    if (chip) chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
    if (t.closest('[data-act=cancel]')) close();
  });

  // Enter в поле новой метки добавляет метку, а не отправляет форму
  newTag.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTagChip(newTag.value);
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    addTagChip(newTag.value);
    const fd = new FormData(form);
    const picked = (group: string) =>
      [...form.querySelectorAll<HTMLButtonElement>(`[data-group=${group}] .chip[aria-pressed=true]`)].map((b) => b.dataset.v!);
    const next: TaskInput = {
      title: String(fd.get('title') ?? '').trim(),
      descr: String(fd.get('descr') ?? ''),
      status: String(fd.get('status')),
      due: String(fd.get('due') ?? '') || null,
      priority: Number(fd.get('priority')) as Priority,
      assignees: picked('assignees'),
      tags: picked('tags'),
    };
    if (!next.title) {
      err.textContent = 'Нужен заголовок.';
      err.hidden = false;
      titleInput.focus();
      return;
    }
    createTask(next).catch((e2) => {
      console.error('Задача не создана', e2);
      toast(writeErrorText(e2), 'bad');
    });
    close();
  });
}
