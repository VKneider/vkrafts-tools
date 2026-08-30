import js from '@eslint/js';
import globals from 'globals';

export default [
   {
      ignores: ['dist/**', 'node_modules/**', 'src/public/**', 'src/bundles/**']
   },
   js.configs.recommended,
   {
      files: ['src/**/*.js', 'api/**/*.js'],
      languageOptions: {
         ecmaVersion: 2023,
         sourceType: 'module',
         globals: {
            ...globals.browser,
            // Global expuesto por el runtime de Slice.js
            slice: 'readonly'
         }
      },
      rules: {
         'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
         'no-console': 'off',
         'prefer-const': 'error',
         eqeqeq: ['error', 'smart']
      }
    }
];
