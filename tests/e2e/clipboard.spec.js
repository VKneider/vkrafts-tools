import { test, expect } from '@playwright/test';
import { gotoLayouts, getState, makePng } from './helpers.js';

test.describe('Portapapeles', () => {
   test('pegar una imagen la agrega a la biblioteca y la coloca', async ({ page }) => {
      await gotoLayouts(page);
      await expect(page.locator('slice-pool-card')).toHaveCount(0);

      const base64 = makePng(80, 60).toString('base64');
      await page.evaluate((data) => {
         const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
         const file = new File([bytes], 'pegada.png', { type: 'image/png' });
         const clipboard = new DataTransfer();
         clipboard.items.add(file);
         document.dispatchEvent(new ClipboardEvent('paste', {
            clipboardData: clipboard,
            bubbles: true
         }));
      }, base64);

      await expect(page.locator('slice-pool-card')).toHaveCount(1);
      const state = await getState(page);
      expect(state.pool[0].name).toBe('pegada.png');
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);
   });
});
