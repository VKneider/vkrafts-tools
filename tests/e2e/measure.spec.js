import { test, expect } from '@playwright/test';
import {
   gotoLayouts,
   uploadImages,
   cellMetrics,
   editCellMeasures,
   getExportPlan,
   setPreset
} from './helpers.js';

async function getGeometry(page) {
   return page.evaluate(() => {
      const el = document.querySelector('slice-layouts-section');
      const sheet = el._sheet();
      const geo = el._cellGeometry(
         sheet,
         el._templates.get(sheet.templateId),
         el._templates.page(sheet.pageId),
         el._templates.preset(sheet.presetId)
      );
      return {
         colWmm: geo.colWmm,
         rowHmm: geo.rowHmm,
         originXMm: geo.originXMm,
         originYMm: geo.originYMm,
         colFixed: geo.colFixed,
         rowFixed: geo.rowFixed
      };
   });
}

test.describe('Editar medidas de celda', () => {
   test('aplica 2 cm exactos y no deforma ni mueve las otras celdas', async ({ page }) => {
      await gotoLayouts(page);
      // La vista arranca sin márgenes; este caso mide sobre el preset Normal
      // para conservar las medidas de referencia (95 / 126,5 mm).
      await setPreset(page, 'normal');
      // Cuadradas: con celdas de 2 × 2 cm, el "contain" del plan de exportación
      // coincide exactamente con la celda y la aserción es sobre mm reales.
      await uploadImages(page, 2, { width: 120, height: 120 });
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      // Celda 0 (col 0, fila 0) a 2 × 2 cm.
      await editCellMeasures(page, 0, { widthCm: 2, heightCm: 2 });

      await expect.poll(async () => (await cellMetrics(page, 0)).wMm).toBeCloseTo(20, 1);
      await expect.poll(async () => (await cellMetrics(page, 0)).hMm).toBeCloseTo(20, 1);

      const geo1 = await getGeometry(page);
      expect(geo1.colWmm).toEqual([20, 95]);       // la columna 1 conserva su ancho
      expect(geo1.rowHmm).toEqual([20, 126.5]);    // la fila 1 conserva su alto
      expect(geo1.colFixed).toBe(true);
      expect(geo1.rowFixed).toBe(true);
      expect(geo1.originXMm).toBe(10);             // anclada al margen, no centrada
      expect(geo1.originYMm).toBe(10);

      const firstBefore = await cellMetrics(page, 0);

      // Celda 1 (col 1, misma fila) SOLO ancho a 2 cm.
      await editCellMeasures(page, 1, { widthCm: 2 });
      await expect.poll(async () => (await cellMetrics(page, 1)).wMm).toBeCloseTo(20, 1);

      const firstAfter = await cellMetrics(page, 0);
      // La celda 0 no cambió de tamaño ni de posición.
      expect(firstAfter.left).toBeCloseTo(firstBefore.left, 0);
      expect(firstAfter.top).toBeCloseTo(firstBefore.top, 0);
      expect(firstAfter.widthPx).toBeCloseTo(firstBefore.widthPx, 0);
      expect(firstAfter.heightPx).toBeCloseTo(firstBefore.heightPx, 0);
      expect(firstAfter.wMm).toBeCloseTo(20, 1);
      expect(firstAfter.hMm).toBeCloseTo(20, 1);

      // Solo se tocó el eje X: la fila 0 sigue en 20 mm y la 1 en 126.5 mm.
      const geo2 = await getGeometry(page);
      expect(geo2.colWmm).toEqual([20, 20]);
      expect(geo2.rowHmm).toEqual([20, 126.5]);

      // El plan de exportación (el que alimenta el PDF exacto) coincide.
      const plan = await getExportPlan(page);
      expect(plan).toHaveLength(1);
      expect(plan[0].widthMm).toBe(216);
      expect(plan[0].heightMm).toBe(279);

      const items = plan[0].items;
      expect(items).toHaveLength(2);

      const first = items.find((it) => Math.abs(it.xMm - 10) < 0.01);
      const second = items.find((it) => Math.abs(it.xMm - 36) < 0.01);
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      expect(first.wMm).toBeCloseTo(20, 1);
      expect(first.hMm).toBeCloseTo(20, 1);
      expect(second.wMm).toBeCloseTo(20, 1);
      expect(second.hMm).toBeCloseTo(20, 1);
   });

   test('las medidas por debajo del mínimo se ajustan a 1,5 cm', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      // El input declara min=1.5, pero el valor se fuerza igualmente para
      // verificar que el modelo (no solo el HTML) respeta el mínimo.
      await editCellMeasures(page, 0, { widthCm: 1, heightCm: 1 });

      const geo = await getGeometry(page);
      expect(geo.colWmm[0]).toBeCloseTo(15, 1);
      expect(geo.rowHmm[0]).toBeCloseTo(15, 1);
      expect(geo.colFixed).toBe(true);
      expect(geo.rowFixed).toBe(true);
   });

   test('“Ajustar celdas a la hoja” sale del modo de medidas exactas', async ({ page }) => {
      await gotoLayouts(page);
      await setPreset(page, 'normal');
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      await editCellMeasures(page, 0, { widthCm: 20 });
      expect((await getGeometry(page)).colFixed).toBe(true);

      const cell = page.locator('slice-layouts-section slice-sheet-cell')
         .first()
         .locator('.sheetcell');
      await cell.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Ajustar celdas a la hoja' }).click();

      await expect.poll(async () => (await getGeometry(page)).colFixed).toBe(false);
      const geo = await getGeometry(page);
      expect(geo.rowFixed).toBe(false);
      // Vuelve a repartir el ancho disponible en partes iguales (190 / 2).
      expect(geo.colWmm[0]).toBeCloseTo(95, 1);
      expect(geo.colWmm[1]).toBeCloseTo(95, 1);
   });

   test('una medida que no entra se escala para no desbordar la hoja', async ({ page }) => {
      await gotoLayouts(page);
      await setPreset(page, 'normal');
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      await editCellMeasures(page, 0, { widthCm: 30 });

      const geo = await getGeometry(page);
      expect(geo.colFixed).toBe(true);
      const total = geo.colWmm.reduce((a, b) => a + b, 0);
      // Con Carta y preset normal quedan 190 mm para las dos columnas.
      expect(total).toBeCloseTo(190, 0);
      expect(geo.colWmm[0]).toBeGreaterThan(geo.colWmm[1]);
   });
});
