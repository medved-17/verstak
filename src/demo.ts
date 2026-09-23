// Демо-данные для проверки вёрстки без входа: только в режиме разработки,
// открывается по адресу localhost:5173/?demo. В сборку для Pages не попадает.
import { DEFAULT_STATUSES, type Member, type SavedView, type Task } from './store';

function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const DEMO_UID = 'demo-me';

export const demoMembers: Member[] = [
  { uid: DEMO_UID, role: 'owner', name: 'Демо Владелец', email: 'owner@example.com', color: '#2440B5' },
  { uid: 'demo-2', role: 'member', name: 'Анна Белова', email: 'anna@example.com', color: '#1A6A4D' },
  { uid: 'demo-3', role: 'member', name: 'Борис Ветров', email: 'boris@example.com', color: '#855100' },
  { uid: 'demo-4', role: 'member', name: 'Вера Громова', email: 'vera@example.com', color: '#5B3A8C' },
  { uid: 'demo-5', role: 'commenter', name: 'Глеб Дёмин', email: 'gleb@example.com', color: '#973040' },
  { uid: 'demo-6', role: 'viewer', name: 'Дина Ершова', email: 'dina@example.com', color: '#657083' },
];

const t = (
  id: string,
  title: string,
  status: string,
  assignees: string[],
  due: string | null,
  priority: 1 | 2 | 3,
  tags: string[],
  order: number,
): Task => ({
  id, title, descr: '', status, assignees, due, priority, tags, order,
  createdBy: DEMO_UID, updatedBy: DEMO_UID,
});

export const demoTasks: Task[] = [
  t('d1', 'Согласовать план работ на квартал', 'now', [DEMO_UID], day(-2), 1, ['План'], 1),
  t('d2', 'Подготовить черновик отчёта для заказчика', 'now', ['demo-2'], day(6), 2, ['Отчёт'], 2),
  t('d3', 'Сверить сроки этапов с календарём проекта', 'backlog', [DEMO_UID, 'demo-4'], day(9), 2, ['План'], 1),
  t('d4', 'Собрать замечания по прототипу в один список', 'backlog', [], null, 3, ['Прототип'], 2),
  t('d5', 'Убрать устаревшие разделы из инструкции', 'review', [DEMO_UID], day(1), 2, ['Документация'], 1),
  t('d6', 'Переписать импорт данных: только нужные поля', 'review', ['demo-3'], day(3), 1, ['Импорт'], 2),
  t('d7', 'Удалить дубли в справочнике контрагентов', 'done', [DEMO_UID], day(0), 1, ['Чистка'], 1),
  t('d8', 'Собрать архив материалов для передачи', 'done', [DEMO_UID], day(0), 2, ['Передача'], 2),
  t('d9', 'Описать правила ролей для нового пространства', 'backlog', ['demo-4'], day(7), 3, ['Верстак'], 3),
  t('d10', 'Проверить выгрузку на трёх тестовых наборах', 'backlog', ['demo-5'], day(-4), 1, ['Проверка'], 4),
];

export const demoWorkspace = {
  id: 'demo',
  name: 'Демо',
  statuses: DEFAULT_STATUSES,
  tags: ['План', 'Отчёт', 'Прототип', 'Документация', 'Импорт', 'Чистка', 'Передача', 'Верстак', 'Проверка'],
};

// Виды из макета
export const demoViews: SavedView[] = [
  { id: 'v2', name: 'Просроченные', icon: '!', filter: { overdue: true }, group: 'none', sort: 'due' },
  { id: 'v3', name: 'Без исполнителя', icon: '○', filter: { unassigned: true }, group: 'none', sort: 'order' },
  { id: 'v4', name: 'Метка «План»', icon: '#', filter: { tags: ['План'] }, group: 'status', sort: 'due' },
];
