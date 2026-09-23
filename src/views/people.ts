// «Люди» — наполняется в T-12
import { getMembers } from '../store';
import { pl } from '../ui/dom';
import type { ViewResult } from './types';

export function viewPeople(): ViewResult {
  const n = getMembers().length;
  return {
    bar: `<h3>Люди</h3><span class="pill">${pl(n, 'участник', 'участника', 'участников')}</span>`,
    body: `<div class="empty2">Список участников и нагрузка появятся в T-12.</div>`,
  };
}
