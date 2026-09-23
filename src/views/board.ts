// Доска — наполняется в T-07
import { getTasks } from '../store';
import type { ViewResult } from './types';

export function viewBoard(): ViewResult {
  return {
    bar: `<h3>Доска</h3>`,
    body: `<div class="empty2">Задач в пространстве: ${getTasks().length}. Колонки появятся в T-07.</div>`,
  };
}
