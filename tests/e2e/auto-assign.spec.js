import { test, expect } from '@playwright/test';
import { gotoLayouts, uploadImages, getState, setQuantity } from './helpers.js';

test.describe('Auto acomodar multicopia / multihoja', () => {
   test('reparte 9 copias en 3 hojas y Ctrl+Z revierte todo', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      await setQuantity(page, 0, 9);
      expect((await getState(page)).pool[0].quantity).toBe(9);

      await page.getByRole('button', { name: /Auto acomodar/ }).click();

      await expect.poll(async () => (await getState(page)).sheets.length).toBe(3);
      const assigned = await getState(page);
      const total = assigned.sheets.reduce(
         (count, sheet) => count + Object.keys(sheet.placement).length,
         0
      );
      expect(total).toBe(9);

      // Las hojas nuevas heredan la configuración de la activa.
      const base = assigned.sheets[0];
      for (const sheet of assigned.sheets.slice(1)) {
         expect(sheet.templateId).toBe(base.templateId);
         expect(sheet.pageId).toBe(base.pageId);
         expect(sheet.presetId).toBe(base.presetId);
         expect(sheet.cols).toEqual(base.cols);
         expect(sheet.rows).toEqual(base.rows);
         expect(sheet.colSizesMm).toEqual(base.colSizesMm);
         expect(sheet.rowSizesMm).toEqual(base.rowSizesMm);
      }

      // Un solo undo devuelve la planilla como estaba antes del acomodo.
      await page.keyboard.press('Control+z');
      await expect.poll(async () => (await getState(page)).sheets.length).toBe(1);

      const undone = await getState(page);
      expect(Object.keys(undone.sheets[0].placement)).toHaveLength(1);
   });
});
