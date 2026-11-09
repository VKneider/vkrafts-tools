import { test, expect } from '@playwright/test';
import {
   gotoLayouts,
   uploadImages,
   getState,
   readDownload,
   pdfMediaBoxes
} from './helpers.js';

const PT_PER_MM = 72 / 25.4;

test.describe('Ajustes de hoja', () => {
   test('fit, escala de imagen y papel A5 llegan a la exportación', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      const panel = page.locator('slice-layouts-panel');
      const sheetState = async () => (await getState(page)).sheets[0];

      await panel.locator('.layoutspanel__fit [data-fit="cover"]').click();
      await expect.poll(async () => (await sheetState()).fitMode).toBe('cover');

      await panel.locator('.layoutspanel__fit [data-fit="contain"]').click();
      await expect.poll(async () => (await sheetState()).fitMode).toBe('contain');

      await panel.locator('.layoutspanel__scale-slider').fill('0.8');
      await expect.poll(async () => (await sheetState()).imageScale).toBeCloseTo(0.8, 2);

      const backgroundSize = await page.evaluate(() =>
         document.querySelector('slice-sheet-cell .sheetcell').style.backgroundSize
      );
      expect(backgroundSize).toContain('80%');

      await page.locator('slice-layouts-panel .slice_select_container').first().click();
      await page.getByRole('option', { name: 'A5 (148×210)' }).click();
      await expect.poll(async () => (await sheetState()).pageId).toBe('a5');

      const [download] = await Promise.all([
         page.waitForEvent('download', { timeout: 60_000 }),
         page.getByRole('button', { name: 'PDF', exact: true }).click()
      ]);

      const boxes = pdfMediaBoxes(readDownload(await download.path()));
      expect(boxes).toHaveLength(1);
      expect(boxes[0][2]).toBeCloseTo(148 * PT_PER_MM, 0);
      expect(boxes[0][3]).toBeCloseTo(210 * PT_PER_MM, 0);
   });

   test('el papel A4 vertical llega a la exportación', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      await page.locator('slice-layouts-panel .slice_select_container').first().click();
      await page.getByRole('option', { name: 'A4 (210×297)' }).click();
      await expect.poll(async () => (await getState(page)).sheets[0].pageId).toBe('a4');

      const [download] = await Promise.all([
         page.waitForEvent('download', { timeout: 60_000 }),
         page.getByRole('button', { name: 'PDF', exact: true }).click()
      ]);

      const boxes = pdfMediaBoxes(readDownload(await download.path()));
      expect(boxes).toHaveLength(1);
      expect(boxes[0][2]).toBeCloseTo(210 * PT_PER_MM, 0);
      expect(boxes[0][3]).toBeCloseTo(297 * PT_PER_MM, 0);
   });
});
