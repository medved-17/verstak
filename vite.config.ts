import { defineConfig } from 'vite';

// Сайт живёт на medved-17.github.io/verstak/, поэтому сборке нужен base.
// В режиме разработки оставляем корень, чтобы localhost открывался без подпути.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/verstak/' : '/',
  build: {
    outDir: 'dist',
    // Firebase SDK (auth + firestore с постоянным кэшем) сам по себе ~590 КБ,
    // ~170 КБ в gzip. Порог выше него, чтобы предупреждение ловило рост нашего кода.
    chunkSizeWarningLimit: 700,
  },
}));
