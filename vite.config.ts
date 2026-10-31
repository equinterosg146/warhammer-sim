import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/warhammer-sim/' : '/',
  server: { port: 5180 },
  test: { environment: 'node' },
});
