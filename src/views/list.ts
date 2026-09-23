// Сохранённый вид — наполняется в T-11 и T-18
import { esc } from '../ui/dom';
import type { ViewResult } from './types';

export function viewList(viewId: string): ViewResult {
  return {
    bar: `<h3>Вид</h3><span class="pill">сохранённый вид</span>`,
    body: `<div class="empty2">Вид «${esc(viewId)}» появится в T-18.</div>`,
  };
}
