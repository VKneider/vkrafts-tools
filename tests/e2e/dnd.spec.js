import { test, expect } from '@playwright/test';
import { gotoLayouts, uploadImages, getState } from './helpers.js';

/** Arrastra con pointer events reales desde el centro de un nodo a otro. */
async function dragTo(page, source, target) {
   const from = await source.boundingBox();
   const to = await target.boundingBox();
   await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
   await page.mouse.down();
   await page.mouse.move(
      to.x + to.width / 2,
      to.y + to.height / 2,
      { steps: 12 }
   );
   // El servicio resuelve el drop en pointerup sobre el droppable.
   await page.mouse.up();
}

test.describe('Drag & drop de la biblioteca y celdas', () => {
   test('arrastrar una imagen de la biblioteca a una celda la coloca', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      const thumb = page.locator('slice-pool-card .poolcard__thumb').first();
      const target = page.locator('slice-layouts-section slice-sheet-cell')
         .nth(2)
         .locator('.sheetcell');

      await dragTo(page, thumb, target);

      await expect.poll(async () => (await getState(page)).sheets[0].placement[2]?.refId)
         .toBeTruthy();
      // La imagen se usó en dos celdas, pero la biblioteca sigue teniendo una.
      expect((await getState(page)).pool).toHaveLength(1);
   });

   test('arrastrar una celda sobre otra intercambia las imágenes', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 2);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      const before = (await getState(page)).sheets[0].placement;
      const firstId = before[0].refId;
      const secondId = before[1].refId;

      const cells = page.locator('slice-layouts-section slice-sheet-cell .sheetcell');
      await dragTo(page, cells.nth(0), cells.nth(1));

      await expect.poll(async () => {
         const placement = (await getState(page)).sheets[0].placement;
         return `${placement[0]?.refId}|${placement[1]?.refId}`;
      }).toBe(`${secondId}|${firstId}`);
   });
});
