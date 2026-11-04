import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    browserName: 'chromium',
    channel: 'msedge',
    viewport: { width: 1440, height: 1080 },
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'npm run dev', url: 'http://127.0.0.1:1420', reuseExistingServer: false },
    { command: 'npm run dev:api', url: 'http://127.0.0.1:5080/health', reuseExistingServer: false, timeout: 60000 },
  ],
});
