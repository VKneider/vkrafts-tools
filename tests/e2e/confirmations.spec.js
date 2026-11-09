import { test, expect } from '@playwright/test';
import { gotoLayouts, uploadImages, getState } from './helpers.js';

test.describe('Confirmaciones destructivas', () => {
   test('limpiar hoja: cancelar conserva, confirmar limpia', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 2);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      const placements = async () =>
         Object.keys((await getState(page)).sheets[0].placement).length;

      await page.getByRole('button', { name: /Limpiar hoja/ }).click();
      await page.getByRole('button', { name: 'Cancelar' }).click();
      await expect.poll(placements).toBe(2);

      await page.getByRole('button', { name: /Limpiar hoja/ }).click();
      await page.getByRole('button', { name: 'Limpiar', exact: true }).click();

      await expect.poll(placements).toBe(0);
      expect((await getState(page)).pool).toHaveLength(2);
   });

   test('eliminar una hoja con contenido pide confirmación', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      await page.getByRole('button', { name: /Duplicar/ }).click();
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip')).toHaveCount(2);

      await page.getByRole('button', { name: /Eliminar Hoja 2/ }).click();
      await page.getByRole('button', { name: 'Cancelar' }).click();
      expect((await getState(page)).sheets).toHaveLength(2);

      await page.getByRole('button', { name: /Eliminar Hoja 2/ }).click();
      await page.getByRole('button', { name: 'Eliminar', exact: true }).click();

      await expect.poll(async () => (await getState(page)).sheets.length).toBe(1);
   });
});
