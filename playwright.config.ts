import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5199',
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1100 } } },
    { name: 'phone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    {
      name: 'tablet',
      use: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command:
      'DATA_DIR=./.local/browser-data PORT=3101 APP_BASE_URL=http://localhost:5199 pnpm exec concurrently -k "node --import tsx server/index.ts" "vite --host 127.0.0.1 --port 5199"',
    url: 'http://localhost:5199/api/health',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
