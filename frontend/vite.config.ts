import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    // The backend only accepts this exact origin (CORS_ORIGINS), so never drift to another port.
    port: 5173,
    strictPort: true,
  },
});
