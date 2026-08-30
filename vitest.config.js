import { defineConfig } from 'vitest/config';

export default defineConfig({
   test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.test.js'],
      coverage: {
         provider: 'v8',
         include: ['src/Components/Service/**/*.js']
      },
      env: {
         VITEST_POOL_ID: '0'
      }
   }
});
