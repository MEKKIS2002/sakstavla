import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1360, height: 900 } },
  webServer: {
    command: 'node tests/serve-dist.mjs',
    url: 'http://127.0.0.1:4173/sakstavla/',
    reuseExistingServer: false
  }
});
