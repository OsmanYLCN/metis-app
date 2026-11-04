import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/login-ui', workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:1420', channel: 'msedge', viewport: { width: 1360, height: 960 }, trace: 'off' },
  webServer: {
    command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: 'https://test-project.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
  },
});
