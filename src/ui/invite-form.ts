// Окно «Пригласить»: выбор роли → ссылка на 7 дней
import { createInvite, invitableRoles, INVITE_DAYS, type Role } from '../store';
import { ROLE_TITLES } from '../views/people';
import { esc } from './dom';
import { openModal } from './modal';
import { toast, writeErrorText } from './toast';

export function inviteLink(token: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}#/invite/${token}`;
}

export function openInviteForm(): void {
  const roles = invitableRoles();
  if (!roles.length) return;
  const { el, close } = openModal(`
    <form class="tform" novalidate>
      <h3>Пригласить в пространство</h3>
      <label class="fld"><span class="k">Роль</span>
        <select class="inp" name="role">${roles
          .map((r) => `<option value="${r}"${r === 'member' ? ' selected' : ''}>${esc(ROLE_TITLES[r])}</option>`)
          .join('')}</select>
      </label>
      <p class="muted">Ссылка одноразовая и действует ${INVITE_DAYS} дней. Человек откроет её, войдёт через Google и сразу увидит задачи.</p>
      <div class="fld" data-link hidden><span class="k">Ссылка</span>
        <input class="inp" name="link" readonly>
        <span class="muted" data-until></span>
      </div>
      <div class="acts">
        <button type="button" class="btn" data-act="cancel">Закрыть</button>
        <button type="submit" class="btn pri" data-act="make">Создать ссылку</button>
      </div>
    </form>`);
  const form = el.querySelector<HTMLFormElement>('form')!;
  const make = form.querySelector<HTMLButtonElement>('[data-act=make]')!;
  const linkInput = form.querySelector<HTMLInputElement>('[name=link]')!;
  let link = '';

  form.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-act=cancel]')) close();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (link) {
      // Вторая кнопка — копирование уже выданной ссылки
      await navigator.clipboard?.writeText(link).catch(() => undefined);
      linkInput.select();
      toast('Ссылка скопирована');
      return;
    }
    make.disabled = true;
    try {
      const role = form.querySelector<HTMLSelectElement>('[name=role]')!.value as Role;
      const inv = await createInvite(role);
      link = inviteLink(inv.token);
      linkInput.value = link;
      form.querySelector<HTMLElement>('[data-until]')!.textContent =
        'Действует до ' + inv.expiresAt.toLocaleDateString('ru', { day: 'numeric', month: 'long' });
      form.querySelector<HTMLElement>('[data-link]')!.hidden = false;
      form.querySelector<HTMLSelectElement>('[name=role]')!.disabled = true;
      make.textContent = 'Скопировать';
      linkInput.select();
    } catch (err) {
      console.error('Не удалось создать приглашение', err);
      toast(writeErrorText(err), 'bad');
    } finally {
      make.disabled = false;
    }
  });
}
