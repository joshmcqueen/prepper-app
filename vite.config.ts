import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const https =
    env.TLS_CERT && env.TLS_KEY
      ? { cert: fs.readFileSync(env.TLS_CERT), key: fs.readFileSync(env.TLS_KEY) }
      : undefined;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      https,
      proxy: Object.fromEntries(
        ['/api', '/uploads'].map((path) => [
          path,
          { target: `${https ? 'https' : 'http'}://localhost:${env.PORT || 3001}`, secure: false },
        ]),
      ),
    },
  };
});
