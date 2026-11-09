import { test, expect } from '@playwright/test';
import { gotoLayouts, uploadImages, getGeometry, getState, cellMetrics } from './helpers.js';

test.describe('Splitters y zoom', () => {
   test('el splitter reparte mm, doble clic resetea y el zoom conserva px ≡ mm', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      const initial = await getGeometry(page);
      expect(initial.colWmm).toEqual([95, 95]);

      const splitter = page.locator('slice-layouts-section .layoutssection__splitter--v');
      const box = await splitter.boundingBox();
      expect(box).toBeTruthy();

      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 50, y, { steps: 6 });
      await page.mouse.up();

      await expect.poll(async () => (await getGeometry(page)).colWmm[0]).toBeGreaterThan(96);
      const dragged = await getGeometry(page);
      expect(dragged.colWmm[0] + dragged.colWmm[1]).toBeCloseTo(190, 0);
      expect(dragged.rowHmm).toEqual([126.5, 126.5]);

      // Doble clic: reparte ese eje en partes iguales.
      await splitter.dblclick();
      await expect.poll(async () => (await getGeometry(page)).colWmm[0]).toBeCloseTo(95, 1);

      // Zoom por botón: el tamaño físico no cambia, el px sí.
      const before = await cellMetrics(page, 0);
      const zoomBefore = (await getState(page)).zoom;

      await page.evaluate(() => {
         const el = document.querySelector('slice-layouts-section');
         el.__zoomChip = document.querySelector('.layoutssection__sheetchip');
         el.__zoomCell = document.querySelector('slice-sheet-cell');
      });

      await page.getByRole('button', { name: 'Acercar' }).click();

      await expect.poll(async () => (await getState(page)).zoom).toBeGreaterThan(zoomBefore);

      const sameNodes = await page.evaluate(() => {
         const el = document.querySelector('slice-layouts-section');
         return {
            chip: el.__zoomChip === document.querySelector('.layoutssection__sheetchip')
               && el.__zoomChip.isConnected,
            cell: el.__zoomCell === document.querySelector('slice-sheet-cell')
               && el.__zoomCell.isConnected,
            transform: el.$refs.sheet.style.transform
         };
      });
      // El zoom no debe reconstruir el rail ni la hoja.
      expect(sameNodes.chip).toBe(true);
      expect(sameNodes.cell).toBe(true);
      expect(sameNodes.transform).toContain('scale');

      const zoomed = await cellMetrics(page, 0);
      expect(zoomed.wMm).toBeCloseTo(before.wMm, 1);
      expect(zoomed.widthPx).toBeGreaterThan(before.widthPx);

      await page.getByRole('button', { name: 'Restablecer zoom' }).click();
      await expect.poll(async () => (await getState(page)).zoom).toBeCloseTo(0.7, 2);

      // Ctrl+wheel sobre la hoja también hace zoom.
      const sheet = page.locator('slice-layouts-section .layoutssection__sheet');
      const sheetBox = await sheet.boundingBox();
      await page.mouse.move(sheetBox.x + 40, sheetBox.y + 40);
      const wheelZoom = (await getState(page)).zoom;
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -220);
      await page.keyboard.up('Control');
      await expect.poll(async () => (await getState(page)).zoom).toBeGreaterThan(wheelZoom);
   });
});
