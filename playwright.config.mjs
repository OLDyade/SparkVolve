import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/site',
  outputDir: '.site-test-results',
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4198',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python3 -m http.server 4198 --bind 127.0.0.1 --directory .site',
    url: 'http://127.0.0.1:4198',
    reuseExistingServer: false,
  },
});
