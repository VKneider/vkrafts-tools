import { test, expect } from '@playwright/test';
import {
   gotoLayouts,
   waitForLayouts,
   uploadImages,
   editCellMeasures,
   cellMetrics,
   getState
} from './helpers.js';

test.describe('Persistencia de la sesión', () => {
   test('restaura pool, hojas, medidas, zoom y hoja activa al recargar', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 2);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      await editCellMeasures(page, 0, { widthCm: 2, heightCm: 2 });
      await expect.poll(async () => (await cellMetrics(page, 0)).wMm).toBeCloseTo(20, 1);

      await page.getByRole('button', { name: 'Acercar' }).click();
      const before = await getState(page);
      expect(before.zoom).toBeGreaterThan(0.7);

      await page.getByRole('button', { name: '+ Nueva hoja' }).click();
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip')).toHaveCount(2);
      const activeId = (await getState(page)).activeId;

      // Deja correr el debounce de guardado antes de recargar.
      await page.waitForTimeout(900);
      await page.reload();
      await waitForLayouts(page);

      await expect(page.locator(
         'slice-layouts-panel .layoutspanel__gallery-head .layoutspanel__label'
      )).toHaveText('Biblioteca (2)');

      const after = await getState(page);
      expect(after.pool).toHaveLength(2);
      expect(after.sheets).toHaveLength(2);
      expect(after.activeId).toBe(activeId);
      expect(after.zoom).toBeCloseTo(before.zoom, 3);

      const measured = after.sheets.find((sheet) => Array.isArray(sheet.colSizesMm));
      expect(measured).toBeTruthy();
      expect(measured.colSizesMm[0]).toBeCloseTo(20, 1);
      expect(measured.rowSizesMm[0]).toBeCloseTo(20, 1);
      expect(Object.keys(measured.placement)).toHaveLength(2);
   });

   test('pagehide fuerza un flush sincrónico del último cambio', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);

      // Cambio + pagehide en la misma tarea: el debounce de 600 ms no puede
      // ganarle. Sin flush, localStorage conserva el zoom anterior.
      const raw = await page.evaluate(() => {
         const el = document.querySelector('slice-layouts-section');
         el._ctx.patch({ zoom: 0.93 });
         window.dispatchEvent(new Event('pagehide'));
         return localStorage.getItem('vkrafts:sheet-layout');
      });

      expect(raw).toBeTruthy();
      const layout = JSON.parse(raw);
      expect(layout.zoom).toBeCloseTo(0.93, 3);
   });

   test('lee una sesión vieja guardada con la clave plana de localStorage', async ({ page }) => {
      // StorageService se configura con namespace 'vkrafts' y key 'sheet-layout',
      // que produce exactamente 'vkrafts:sheet-layout' (la clave histórica).
      await page.addInitScript(() => {
         localStorage.setItem('vkrafts:sheet-layout', JSON.stringify({
            version: 1,
            savedAt: Date.now(),
            activeId: 'legacy',
            zoom: 0.84,
            sheets: [{
               id: 'legacy',
               pageId: 'a4',
               templateId: 'm2x2',
               presetId: 'normal',
               fitMode: 'smart',
               imageScale: 1,
               placement: {}
            }]
         }));
      });

      await gotoLayouts(page);
      const state = await getState(page);
      expect(state.zoom).toBeCloseTo(0.84, 2);
      expect(state.sheets[0].id).toBe('legacy');
      expect(state.sheets[0].pageId).toBe('a4');
   });

   test('muestra Guardado y Error al guardar', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);

      const status = page.locator('slice-layouts-section .layoutssection__savestate');
      await expect(status).toHaveText('Guardado', { timeout: 10_000 });
   });

   test('muestra el error si el almacenamiento rechaza la escritura', async ({ page }) => {
      await page.addInitScript(() => {
         const original = Storage.prototype.setItem;
         Storage.prototype.setItem = function (key, value) {
            if (String(key).includes('vkrafts:sheet-layout')) {
               throw new DOMException('QuotaExceededError', 'QuotaExceededError');
            }
            return original.call(this, key, value);
         };
      });

      await gotoLayouts(page);
      await uploadImages(page, 1);

      await expect(page.locator('slice-layouts-section .layoutssection__savestate'))
         .toHaveText('Error al guardar', { timeout: 10_000 });
      await expect(page.getByText(/No se pudo guardar la planilla/)).toBeVisible();
   });

   test('avisa cuando la cuota de IndexedDB está casi llena', async ({ page }) => {
      await page.addInitScript(() => {
         Object.defineProperty(navigator.storage, 'estimate', {
            configurable: true,
            value: async () => ({ usage: 95, quota: 100 })
         });
      });

      await gotoLayouts(page);
      await uploadImages(page, 1);

      await expect(page.locator('slice-layouts-section .layoutssection__savestate'))
         .toHaveText('Poco espacio', { timeout: 10_000 });
      await expect(page.getByText(/Queda poco espacio/)).toBeVisible();
   });
});
