import { test, expect } from '@playwright/test';
import { gotoLayouts, getState, makeHeic } from './helpers.js';

const galleryTitle = 'slice-layouts-panel .layoutspanel__gallery-head .layoutspanel__label';

test.describe('HEIC/HEIF', () => {
   test('subir un HEIC lo convierte a JPEG y lo coloca', async ({ page }) => {
      await gotoLayouts(page);

      await page.locator('slice-layouts-section input[data-ref="picker"]').setInputFiles({
         name: 'retrato.heic',
         mimeType: 'image/heic',
         buffer: makeHeic()
      });

      await expect(page.locator(galleryTitle)).toHaveText('Biblioteca (1)', {
         timeout: 30_000
      });
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      const state = await getState(page);
      expect(state.pool[0].name).toBe('retrato.jpg');
   });

   test('pegar un HEIC desde el portapapeles también lo convierte', async ({ page }) => {
      await gotoLayouts(page);

      const base64 = makeHeic().toString('base64');
      await page.evaluate((data) => {
         const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
         const file = new File([bytes], 'pegado.heic', { type: 'image/heic' });
         const clipboard = new DataTransfer();
         clipboard.items.add(file);
         document.dispatchEvent(new ClipboardEvent('paste', {
            clipboardData: clipboard,
            bubbles: true
         }));
      }, base64);

      await expect(page.locator('slice-pool-card')).toHaveCount(1, { timeout: 30_000 });
      const state = await getState(page);
      expect(state.pool[0].name).toBe('pegado.jpg');
   });
});
