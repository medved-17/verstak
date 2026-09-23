// Точка входа. Маршрутизация по hash появится вместе с экранами.
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.innerHTML = `
    <main class="stub">
      <h1>Верстак</h1>
      <p>Трекер задач команды</p>
    </main>`;
}
