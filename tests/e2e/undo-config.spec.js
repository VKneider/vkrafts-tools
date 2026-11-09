import { test, expect } from '@playwright/test';
import { gotoLayouts, uploadImages, getState } from './helpers.js';

test.describe('Undo de configuración', () => {
   test('papel, plantilla, preset y producto entran al historial', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);

      const sheetState = async () => (await getState(page)).sheets[0];

      // Papel (Select del panel: el contenedor es el disparador real).
      await page.locator('slice-layouts-panel .slice_select_container').first().click();
      await page.getByRole('option', { name: 'A4 (210×297)' }).click();
      await expect.poll(async () => (await sheetState()).pageId).toBe('a4');
      await page.keyboard.press('Control+z');
      await expect.poll(async () => (await sheetState()).pageId).toBe('carta');

      // Preset de márgenes.
      await page.locator('.layoutspanel__chip[data-preset-id="wide"]').click();
      await expect.poll(async () => (await sheetState()).presetId).toBe('wide');
      await page.keyboard.press('Control+z');
      await expect.poll(async () => (await sheetState()).presetId).toBe('normal');

      // Plantilla.
      await page.locator('.layoutspanel__tpl-mini[data-template-id="m2"]').click();
      await expect.poll(async () => (await sheetState()).templateId).toBe('m2');
      await page.keyboard.press('Control+z');
      await expect.poll(async () => (await sheetState()).templateId).toBe('m2x2');

      // Producto (fija ambos ejes y cambia la grilla).
      await page.locator('.layoutspanel__product[data-product-id="sticker-5"]').click();
      await expect.poll(async () => (await sheetState()).productId).toBe('sticker-5');
      await page.keyboard.press('Control+z');

      await expect.poll(async () => (await sheetState()).productId).toBeNull();
      const restored = await sheetState();
      expect(restored.templateId).toBe('m2x2');
      expect(restored.cellSizeMm).toBeNull();
   });
});
