import { test, expect } from '@playwright/test';
import { gotoLayouts, uploadImages, getState } from './helpers.js';

test.describe('Hojas y biblioteca', () => {
   test('el rail de hojas hace scroll, mantiene las acciones visibles y sigue a la activa', async ({ page }) => {
      await gotoLayouts(page);

      const addSheet = page.getByRole('button', { name: '+ Nueva hoja' });
      for (let i = 0; i < 8; i++) {
         await addSheet.click();
         await expect(page.locator('slice-layouts-section .layoutssection__sheetchip'))
            .toHaveCount(i + 2);
      }

      const rail = await page.evaluate(() => {
         const bar = document.querySelector('slice-layouts-section .layoutssection__sheetsbar');
         const wrap = bar.querySelector('.layoutssection__sheetsrailwrap');
         const track = bar.querySelector('.layoutssection__sheetsrail');
         const actions = bar.querySelector('.layoutssection__sheetactions');
         const active = track.querySelector('.layoutssection__sheetchip.is-active');
         const activeBox = active.getBoundingClientRect();
         const trackBox = track.getBoundingClientRect();
         return {
            chips: track.querySelectorAll('.layoutssection__sheetchip').length,
            scrollable: track.scrollWidth > track.clientWidth + 1,
            classes: wrap.className,
            barHeight: bar.getBoundingClientRect().height,
            actionsVisible: actions.getBoundingClientRect().width > 0,
            activeVisible:
               activeBox.left >= trackBox.left - 1 &&
               activeBox.right <= trackBox.right + 1
         };
      });

      expect(rail.chips).toBe(9);
      expect(rail.scrollable).toBe(true);
      expect(rail.classes).toContain('is-scrollable');
      expect(rail.barHeight).toBeLessThan(60);
      expect(rail.actionsVisible).toBe(true);
      expect(rail.activeVisible).toBe(true);

      // Volver a la primera hoja: el carril vuelve al inicio.
      await page.locator('slice-layouts-section .layoutssection__sheetchip')
         .first()
         .locator('.layoutssection__sheetchip-main')
         .click();

      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip.is-active'))
         .toContainText('Hoja 1');
      await expect.poll(async () => page.evaluate(() =>
         document.querySelector('slice-layouts-section .layoutssection__sheetsrail').scrollLeft
      )).toBeLessThan(2);
   });

   test('la biblioteca pagina de a 12 y salta a la última página al agregar', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 13);

      const pager = page.locator('slice-layouts-panel .layoutspanel__gallery-pager');
      await expect(pager).toBeVisible();
      await expect(page.locator('slice-layouts-panel .slice-pagination__compact'))
         .toHaveText('Página 2 de 2');
      await expect(page.locator('slice-layouts-panel .slice-pagination__info'))
         .toHaveText('13–13 de 13');
      await expect(page.locator('slice-pool-card')).toHaveCount(1);

      await page.getByRole('button', { name: 'Página anterior' }).click();
      await expect(page.locator('slice-layouts-panel .slice-pagination__compact'))
         .toHaveText('Página 1 de 2');
      await expect(page.locator('slice-layouts-panel .slice-pagination__info'))
         .toHaveText('1–12 de 13');
      await expect(page.locator('slice-pool-card')).toHaveCount(12);

      await page.getByRole('button', { name: 'Página siguiente' }).click();
      await expect(page.locator('slice-layouts-panel .slice-pagination__compact'))
         .toHaveText('Página 2 de 2');
      await expect(page.locator('slice-pool-card')).toHaveCount(1);
   });

   test('al borrar la última imagen de la página 2 vuelve a la página 1', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 13);

      const pager = page.locator('slice-layouts-panel .layoutspanel__gallery-pager');
      await expect(page.locator('slice-layouts-panel .slice-pagination__compact'))
         .toHaveText('Página 2 de 2');
      await expect(page.locator('slice-pool-card')).toHaveCount(1);

      // La imagen 13 no entra en la hoja activa, así que se borra sin diálogo.
      await page.locator('slice-pool-card .poolcard__del').click();

      await expect(pager).toBeHidden();
      await expect(page.locator(
         'slice-layouts-panel .layoutspanel__gallery-head .layoutspanel__label'
      )).toHaveText('Biblioteca (12)');
      await expect(page.locator('slice-pool-card')).toHaveCount(12);
   });

   test('el paginador aparece recién con la imagen 13', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 12);

      const pager = page.locator('slice-layouts-panel .layoutspanel__gallery-pager');
      await expect(pager).toBeHidden();

      await uploadImages(page, 1, { total: 13 });
      await expect(pager).toBeVisible();
      await expect(page.locator('slice-layouts-panel .slice-pagination__compact'))
         .toHaveText('Página 2 de 2');
   });

   test('la biblioteca filtra por nombre y muestra el estado vacío', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 3);

      const title = page.locator(
         'slice-layouts-panel .layoutspanel__gallery-head .layoutspanel__label'
      );
      const search = page.getByPlaceholder('Buscar imagen…');

      await search.fill('01');
      await expect(title).toHaveText('Biblioteca (1/3)');
      await expect(page.locator('slice-pool-card')).toHaveCount(1);
      await expect(page.locator('.layoutspanel__gallery-pager')).toBeHidden();

      await search.fill('zzz');
      await expect(title).toHaveText('Biblioteca (0/3)');
      await expect(page.locator('slice-pool-card')).toHaveCount(0);
      await expect(page.locator('.layoutspanel__gallery-empty')).toBeVisible();

      await search.fill('');
      await expect(title).toHaveText('Biblioteca (3)');
      await expect(page.locator('slice-pool-card')).toHaveCount(3);
   });

   test('una imagen en espera se asigna al hacer click en una celda vacía', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 2);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      const thumb = page.locator('slice-pool-card .poolcard__thumb').first();
      await thumb.click();
      await expect(thumb).toHaveClass(/is-pending/);

      const emptyCell = page.locator('slice-layouts-section slice-sheet-cell')
         .nth(2)
         .locator('.sheetcell');
      await emptyCell.click();

      await expect.poll(async () => (await getState(page)).sheets[0].placement[2]?.refId)
         .toBeTruthy();
      await expect(thumb).not.toHaveClass(/is-pending/);
   });

   test('Vaciar reinicia la planilla a una sola hoja en blanco', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      await page.getByRole('button', { name: /Duplicar/ }).click();
      await page.getByRole('button', { name: '+ Nueva hoja' }).click();
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip')).toHaveCount(3);

      await page.locator('.layoutspanel__gallery-clear').click();
      await page.getByRole('button', { name: 'Vaciar todo' }).click();

      await expect.poll(async () => (await getState(page)).pool.length).toBe(0);
      const state = await getState(page);
      expect(state.sheets).toHaveLength(1);
      expect(state.activeId).toBe(state.sheets[0].id);
      expect(Object.keys(state.sheets[0].placement)).toHaveLength(0);

      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip')).toHaveCount(1);
      await expect(page.locator('.layoutspanel__gallery-wrap')).toBeHidden();
      await expect(page.locator('slice-layouts-section .layoutssection__hint')).toBeVisible();
   });

   test('el menú de desborde lista y activa todas las hojas', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      for (let i = 0; i < 4; i++) {
         await page.getByRole('button', { name: '+ Nueva hoja' }).click();
      }
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip'))
         .toHaveCount(5);

      const overview = page.getByRole('button', { name: 'Hojas (5)' });
      await expect(overview).toBeVisible();
      await overview.click();

      const items = page.getByRole('menuitem');
      await expect(items).toHaveCount(5);
      await expect(items.first()).toHaveText(/Hoja 1 · 1\/4/);

      await page.getByRole('menuitem', { name: /Hoja 2/ }).click();
      const state = await getState(page);
      expect(state.activeId).toBe(state.sheets[1].id);
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip.is-active'))
         .toHaveCount(1);
   });
});
