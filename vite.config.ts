import { defineConfig } from 'vite';

// Сайт живёт на medved-17.github.io/verstak/, поэтому сборке нужен base.
// В режиме разработки оставляем корень, чтобы localhost открывался без подпути.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/verstak/' : '/',
  build: { outDir: 'dist' },
}));
