import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 15373,
    strictPort: mode !== 'browser',
  },
  envPrefix: ['VITE_', 'TAURI_'],
}));
