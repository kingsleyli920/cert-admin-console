import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const webPort = Number(process.env.WEB_PORT || 5173);
const apiPort = Number(process.env.PORT || 3001);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
});
