import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Shares the main app's .env (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY):
  // both apps use the same Supabase project. A vitalink-sentinel/.env still
  // overrides it when Sentinel is deployed on its own.
  envDir: path.resolve(__dirname, '..'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
