import { test, expect } from '@playwright/test';
import {
   gotoLayouts,
   uploadImages,
   getState,
   getGeometry,
   getExportPlan,
   cellMetrics,
   readDownload,
   pdfMediaBoxes
} from './helpers.js';

const PT_PER_MM = 72 / 25.4;

test.describe('Features nuevas de plantilla', () => {
   test('renombrar y mover hojas desde el chip', async ({ page }) => {
      await gotoLayouts(page);

      const chips = page.locator('slice-layouts-section .layoutssection__sheetchip');
      const firstMain = chips.first().locator('.layoutssection__sheetchip-main');

      await firstMain.dblclick();
      const input = page.locator('slice-layouts-section .layoutssection__sheetrename');
      await expect(input).toBeVisible();
      await input.fill('Tapa');
      await input.press('Enter');

      await expect(chips.first().locator('.layoutssection__sheetchip-main'))
         .toContainText('Tapa');
      let state = await getState(page);
      expect(state.sheets[0].name).toBe('Tapa');

      // Segunda hoja: queda activa y se mueve a la izquierda de “Tapa”.
      await page.getByRole('button', { name: '+ Nueva hoja' }).click();
      await expect(chips).toHaveCount(2);
      const secondId = (await getState(page)).activeId;
      expect(secondId).not.toBe(state.sheets[0].id);

      await chips.nth(1).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Mover a la izquierda' }).click();

      await expect.poll(async () => (await getState(page)).sheets[0].id).toBe(secondId);
      state = await getState(page);
      expect(state.sheets[0].name).toBeNull();
      expect(state.sheets[1].name).toBe('Tapa');

      const labels = await chips.locator('.layoutssection__sheetchip-main').allInnerTexts();
      expect(labels[0]).toContain('Hoja 1');
      expect(labels[1]).toContain('Tapa');
   });

   test('aplicar medidas a todas las celdas deja la hoja uniforme', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 2, { width: 120, height: 120 });
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      const cell = page.locator('slice-layouts-section slice-sheet-cell')
         .first()
         .locator('.sheetcell');
      await cell.click({ button: 'right' });
      await page.getByRole('menuitem', { name: /Editar medidas/ }).click();

      await page.getByLabel('Aplicar a todas las celdas').check();
      await page.getByLabel('Ancho de columna (cm)').fill('2');
      await page.getByLabel('Alto de fila (cm)').fill('2');
      await page.locator('slice-cell-size-modal')
         .getByRole('button', { name: 'Aplicar' })
         .click();
      await expect(page.getByLabel('Ancho de columna (cm)')).toBeHidden();

      await expect.poll(async () => (await getGeometry(page)).colWmm[0]).toBeCloseTo(20, 1);
      const geo = await getGeometry(page);
      expect(geo.colWmm).toEqual([20, 20]);
      expect(geo.rowHmm).toEqual([20, 20]);

      for (const slot of [0, 1, 2, 3]) {
         const metrics = await cellMetrics(page, slot);
         expect(metrics.wMm).toBeCloseTo(20, 1);
         expect(metrics.hMm).toBeCloseTo(20, 1);
      }
   });

   test('grilla y márgenes personalizados', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      const grid = page.locator('slice-layouts-panel .layoutspanel__customgrid');
      await grid.getByLabel('Columnas').fill('3');
      await grid.getByLabel('Filas').fill('2');
      await grid.getByRole('button', { name: 'Aplicar' }).click();

      await expect.poll(async () => (await getState(page)).sheets[0].templateId)
         .toBe('grid-3x2');
      await expect(page.locator('slice-layouts-section slice-sheet-cell')).toHaveCount(6);

      const margins = page.locator('slice-layouts-panel .layoutspanel__custommargins');
      await margins.getByLabel('Margen (cm)').fill('2');
      await margins.getByLabel('Separación (cm)').fill('1');
      await margins.getByRole('button', { name: 'Aplicar' }).click();

      await expect.poll(async () => (await getState(page)).sheets[0].presetId)
         .toBe('custom-20.0-10.0');

      const preset = await page.evaluate(() => {
         const el = document.querySelector('slice-layouts-section');
         const sheet = el._sheet();
         return el._templates.preset(sheet.presetId);
      });
      expect(preset.marginMm).toBe(20);
      expect(preset.gapMm).toBe(10);
   });

   test('el papel horizontal se aplica a todas las hojas y al PDF', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      // Duplicar conserva la imagen: dos hojas con contenido para el PDF.
      await page.getByRole('button', { name: /Duplicar/ }).click();
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip')).toHaveCount(2);

      await page.locator('slice-layouts-panel .slice_select_container').first().click();
      await page.getByRole('option', { name: 'A4 horizontal (297×210)' }).click();

      await expect.poll(async () => (await getState(page)).sheets.every(
         (sheet) => sheet.pageId === 'a4-h'
      )).toBe(true);

      const plan = await getExportPlan(page);
      expect(plan).toHaveLength(2);
      expect(plan.every((p) => p.widthMm === 297 && p.heightMm === 210)).toBe(true);

      const [download] = await Promise.all([
         page.waitForEvent('download', { timeout: 60_000 }),
         page.getByRole('button', { name: 'PDF', exact: true }).click()
      ]);

      const boxes = pdfMediaBoxes(readDownload(await download.path()));
      expect(boxes).toHaveLength(2);
      for (const box of boxes) {
         expect(box[2]).toBeCloseTo(297 * PT_PER_MM, 0);
         expect(box[3]).toBeCloseTo(210 * PT_PER_MM, 0);
      }
   });

   test('bloquear proporción ajusta el otro eje', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1, { width: 120, height: 120 });
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      const cell = page.locator('slice-layouts-section slice-sheet-cell')
         .first()
         .locator('.sheetcell');
      await cell.click({ button: 'right' });
      await page.getByRole('menuitem', { name: /Editar medidas/ }).click();

      await page.getByLabel('Mantener proporción').check();
      await page.getByLabel('Ancho de columna (cm)').fill('4');
      await expect(page.getByLabel('Alto de fila (cm)')).toHaveValue('5.3');

      await page.locator('slice-cell-size-modal')
         .getByRole('button', { name: 'Aplicar' })
         .click();
      await expect.poll(async () => (await getGeometry(page)).colWmm[0]).toBeCloseTo(40, 1);

      const geo = await getGeometry(page);
      expect(geo.rowHmm[0]).toBeCloseTo(53, 0);
      // La proporción original (95 / 126.5) se conserva.
      expect(geo.colWmm[0] / geo.rowHmm[0]).toBeCloseTo(95 / 126.5, 1);
   });

   test('los tamaños estándar de carnet están disponibles', async ({ page }) => {
      await gotoLayouts(page);

      const chip = page.locator(
         'slice-layouts-panel .layoutspanel__product[data-product-id="carnet-3x4"]'
      );
      await expect(chip).toHaveText('Carnet 3×4');
      await chip.click();

      await expect.poll(async () => {
         const sheet = (await getState(page)).sheets[0];
         return `${sheet.productId}:${sheet.cellSizeMm?.w}x${sheet.cellSizeMm?.h}`;
      }).toBe('carnet-3x4:30x40');
   });
});
