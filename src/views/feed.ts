// Лента — наполняется в T-17
import type { ViewResult } from './types';

export function viewFeed(): ViewResult {
  return {
    bar: `<h3>Лента</h3>`,
    body: `<div class="empty2">Лента изменений появится в T-17.</div>`,
  };
}
