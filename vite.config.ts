import { defineConfig } from 'vite';

// base для GitHub Pages задаётся в T-02, когда известно имя репозитория
export default defineConfig({
  build: { outDir: 'dist' },
});
