import { defineConfig, devices } from '@playwright/test';

// E2E de la app real (Slice dev server). Un solo worker: las pruebas de
// exportación rasterizan hojas grandes y comparten el bundle del navegador.
export default defineConfig({
   testDir: './tests/e2e',
   fullyParallel: false,
   workers: 1,
   timeout: 90_000,
   expect: { timeout: 10_000 },
   reporter: [['list']],
   use: {
      baseURL: 'http://127.0.0.1:3101',
      acceptDownloads: true,
      viewport: { width: 1440, height: 950 },
      trace: 'retain-on-failure',
      screenshot: 'only-on-failure'
   },
   projects: [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
   ],
   webServer: {
      command: 'node ./node_modules/slicejs-cli/client.js dev --port 3101',
      url: 'http://127.0.0.1:3101',
      // En local reutiliza el server que ya esté corriendo; en CI lo levanta.
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
   }
});
