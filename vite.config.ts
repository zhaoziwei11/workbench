import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 用相对路径，保证 Electron 以 file:// 加载 dist 时资源路径正确
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    // 不清空旧输出: 避免 Node fs.rmSync 触发环境"安全删除"拦截, 也避免每次构建弹 Windows 确认框。
    // 代价: 旧 hash 资源会留在 dist 里, 但 index.html 每次都会被覆盖、新 hash 资源也会写入, 不影响运行。
    emptyOutDir: false,
  },
});
