import { test, expect } from '@playwright/test';
import {
   gotoLayouts,
   waitForLayouts,
   uploadImages,
   getState,
   getExportPlan,
   selectCell,
   dragTo,
   makePng
} from './helpers.js';

test.describe('Atajos sobre la celda seleccionada', () => {
   test('Ctrl+C/V y Delete operan sobre la selección, no sobre la primera celda', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 2);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      const initial = await getState(page);
      const first = initial.sheets[0].placement[0];
      const second = initial.sheets[0].placement[1];
      expect(first?.refId).toBeTruthy();
      expect(second?.refId).toBeTruthy();
      expect(first.refId).not.toBe(second.refId);

      // Copiar la celda 1 (segunda imagen) y pegarla sobre la celda 0.
      await selectCell(page, 1);
      await page.keyboard.press('Control+c');
      await selectCell(page, 0);
      await page.keyboard.press('Control+v');

      await expect.poll(async () => (await getState(page)).sheets[0].placement[0]?.refId)
         .toBe(second.refId);

      // Delete sobre la celda 1: debe quitar esa, no la 0.
      await selectCell(page, 1);
      await page.keyboard.press('Delete');

      await expect.poll(async () => (await getState(page)).sheets[0].placement[1])
         .toBeUndefined();
      const afterDelete = await getState(page);
      expect(afterDelete.sheets[0].placement[0]?.refId).toBe(second.refId);
   });

   test('el menú de una celda vacía ofrece "Pegar aquí"', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 2);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      await selectCell(page, 0);
      await page.keyboard.press('Control+c');

      // La celda 2 está vacía: click derecho → Pegar aquí.
      const emptyCell = page.locator('slice-layouts-section slice-sheet-cell')
         .nth(2)
         .locator('.sheetcell');
      await emptyCell.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Pegar aquí' }).click();

      await expect.poll(async () => (await getState(page)).sheets[0].placement[2]?.refId)
         .toBeTruthy();
   });

   test('navegación por teclado entre celdas', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 2);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      const first = page.locator('slice-layouts-section slice-sheet-cell .sheetcell').first();
      await first.focus();
      await expect(first).toHaveAttribute('aria-label', /Celda 1/);

      await page.keyboard.press('ArrowRight');
      const activeSlot = await page.evaluate(() => document.activeElement?.dataset?.slot);
      expect(activeSlot).toBe('1');

      const second = page.locator('slice-layouts-section slice-sheet-cell')
         .nth(1)
         .locator('.sheetcell');
      await expect(second).toHaveClass(/sheetcell--selected/);

      // Delete actúa sobre la celda enfocada/seleccionada.
      await page.keyboard.press('Delete');
      await expect.poll(async () => (await getState(page)).sheets[0].placement[1])
         .toBeUndefined();
      expect((await getState(page)).sheets[0].placement[0]).toBeTruthy();
   });

   test('Shift+flechas extiende la selección y Ctrl+A selecciona toda la hoja', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 2);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      const cells = page.locator('slice-layouts-section slice-sheet-cell .sheetcell');
      await cells.nth(0).click();
      await page.keyboard.press('Shift+ArrowRight');

      const twoCells = await page.evaluate(() =>
         [...document.querySelector('slice-layouts-section')._selectedSlots]
            .sort((a, b) => a - b));
      expect(twoCells).toEqual([0, 1]);
      await expect(cells.nth(0)).toHaveClass(/sheetcell--selected/);
      await expect(cells.nth(1)).toHaveClass(/sheetcell--selected/);

      // Con 2 columnas, Shift+Abajo desde la celda 1 completa el rango 0..3.
      await page.keyboard.press('Shift+ArrowDown');
      const rangeSize = await page.evaluate(() =>
         document.querySelector('slice-layouts-section')._selectedSlots.size);
      expect(rangeSize).toBe(4);

      // Ctrl+A selecciona toda la capacidad de la plantilla activa.
      await page.keyboard.press('Control+a');
      const capacity = await cells.count();
      expect(await page.evaluate(() =>
         document.querySelector('slice-layouts-section')._selectedSlots.size
      )).toBe(capacity);

      // Delete en lote vacía las celdas con imagen.
      await page.keyboard.press('Delete');
      await expect.poll(async () =>
         Object.keys((await getState(page)).sheets[0].placement).length
      ).toBe(0);
   });

   test('reemplazar la imagen de una celda', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 2);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      const before = (await getState(page)).sheets[0].placement[0].refId;
      const cell = page.locator('slice-layouts-section slice-sheet-cell')
         .first()
         .locator('.sheetcell');

      await cell.click({ button: 'right' });
      const [chooser] = await Promise.all([
         page.waitForEvent('filechooser'),
         page.getByRole('menuitem', { name: /Reemplazar imagen/ }).click()
      ]);

      await chooser.setFiles({
         name: 'replacement.png',
         mimeType: 'image/png',
         buffer: makePng(90, 60)
      });

      await expect.poll(async () => (await getState(page)).sheets[0].placement[0]?.refId)
         .not.toBe(before);

      const state = await getState(page);
      expect(state.pool).toHaveLength(3);
   });

   test('rotar y voltear actualizan el asset de la biblioteca', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1, { width: 120, height: 90 });
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      const assetInfo = () => page.evaluate(() => {
         const asset = document.querySelector('slice-layouts-section')._state.pool[0];
         return { url: asset.url, pxW: asset.pxW, pxH: asset.pxH };
      });

      const original = await assetInfo();
      expect([original.pxW, original.pxH]).toEqual([120, 90]);

      const cell = page.locator('slice-layouts-section slice-sheet-cell')
         .first()
         .locator('.sheetcell');

      await cell.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Rotar 90° derecha' }).click();

      await expect.poll(async () => (await assetInfo()).pxW).toBe(90);
      const rotated = await assetInfo();
      expect(rotated.pxH).toBe(120);
      expect(rotated.url).not.toBe(original.url);

      await cell.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Voltear horizontal' }).click();

      await expect.poll(async () => (await assetInfo()).url).not.toBe(rotated.url);
      const flipped = await assetInfo();
      expect([flipped.pxW, flipped.pxH]).toEqual([90, 120]);
   });

   test('selección múltiple y acciones en lote', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 2);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      const cells = page.locator('slice-layouts-section slice-sheet-cell .sheetcell');

      await cells.nth(0).click();
      await cells.nth(1).click({ modifiers: ['Control'] });

      const selected = await page.evaluate(() =>
         document.querySelector('slice-layouts-section')._selectedSlots.size
      );
      expect(selected).toBe(2);
      await expect(cells.nth(0)).toHaveClass(/sheetcell--selected/);
      await expect(cells.nth(1)).toHaveClass(/sheetcell--selected/);

      // Ajuste en lote: cubrir las dos.
      await cells.nth(1).click({ button: 'right' });
      await page.getByRole('menuitem', { name: /Ajuste: cubrir \(2\)/ }).click();
      await expect.poll(async () => {
         const placement = (await getState(page)).sheets[0].placement;
         return [placement[0]?.fit, placement[1]?.fit].join(',');
      }).toBe('cover,cover');

      // Quitar en lote.
      await cells.nth(0).click();
      await cells.nth(1).click({ modifiers: ['Control'] });
      await cells.nth(1).click({ button: 'right' });
      await page.getByRole('menuitem', { name: /Quitar 2 celdas/ }).click();

      await expect.poll(async () =>
         Object.keys((await getState(page)).sheets[0].placement).length
      ).toBe(0);
   });

   test('el slider del panel ajusta el zoom de la imagen seleccionada', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      const slider = page.locator('slice-layouts-panel .layoutspanel__crop slice-slider');
      const input = slider.locator('.slice_slider_input--low');
      await expect(input).toBeDisabled();

      const cell = page.locator('slice-layouts-section slice-sheet-cell .sheetcell').first();
      await cell.click();
      await expect(input).toBeEnabled();

      await input.evaluate((el) => {
         el.value = '1.5';
         el.dispatchEvent(new Event('input', { bubbles: true }));
         el.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await expect.poll(async () =>
         (await getState(page)).pool[0]?.cropScale
      ).toBeCloseTo(1.5, 2);

      const backgroundSize = await cell.evaluate((el) => el.style.backgroundSize);
      expect(backgroundSize).toContain('150%');
      await expect(slider.locator('.slice_slider_value')).toHaveText('150%');

      await page.getByRole('button', { name: 'Restablecer zoom de la imagen' }).click();
      await expect.poll(async () => (await getState(page)).pool[0]?.cropScale).toBe(1);
      expect(await cell.evaluate((el) => el.style.backgroundSize)).not.toContain('150%');
   });

   test('el zoom de la imagen no bloquea el drag & drop de celdas', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 2);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      const cells = page.locator('slice-layouts-section slice-sheet-cell .sheetcell');
      await cells.nth(0).click();

      const input = page.locator(
         'slice-layouts-panel .layoutspanel__crop slice-slider .slice_slider_input--low'
      );
      await input.evaluate((el) => {
         el.value = '1.5';
         el.dispatchEvent(new Event('input', { bubbles: true }));
         el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await expect.poll(async () => (await getState(page)).pool[0].cropScale)
         .toBeCloseTo(1.5, 2);

      const before = (await getState(page)).sheets[0].placement;
      const firstId = before[0].refId;
      const secondId = before[1].refId;

      await dragTo(page, cells.nth(0), cells.nth(1));

      await expect.poll(async () => {
         const placement = (await getState(page)).sheets[0].placement;
         return `${placement[0]?.refId}|${placement[1]?.refId}`;
      }).toBe(`${secondId}|${firstId}`);

      // El drag no debe mover el encuadre (eso es Alt+arrastrar).
      expect((await getState(page)).pool[0].cropX).toBeCloseTo(0.5, 2);
   });

   test('el zoom/encuadre se comparte entre todas las copias y persiste', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      // Copia la misma imagen a una segunda celda.
      await selectCell(page, 0);
      await page.keyboard.press('Control+c');
      const cells = page.locator('slice-layouts-section slice-sheet-cell .sheetcell');
      await cells.nth(1).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Pegar aquí' }).click();
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(2);

      // Zoom con el slider del panel sobre la primera copia.
      const first = cells.nth(0);
      await first.click();
      const cropInput = page.locator(
         'slice-layouts-panel .layoutspanel__crop slice-slider .slice_slider_input--low'
      );
      await cropInput.evaluate((el) => {
         el.value = '1.5';
         el.dispatchEvent(new Event('input', { bubbles: true }));
         el.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await expect.poll(async () => (await getState(page)).pool[0].cropScale)
         .toBeCloseTo(1.5, 2);

      const filledCells = page.locator('slice-layouts-section slice-sheet-cell .sheetcell--img');
      const sizes = await filledCells.evaluateAll((els) =>
         els.map((el) => el.style.backgroundSize));
      expect(sizes).toHaveLength(2);
      for (const size of sizes) expect(size).toContain('150%');

      // Alt+arrastrar cambia el encuadre (sin intercambiar celdas).
      const placementBefore = (await getState(page)).sheets[0].placement;
      const box = await first.boundingBox();
      await page.keyboard.down('Alt');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
         box.x + box.width / 2 + 40,
         box.y + box.height / 2 + 20,
         { steps: 8 }
      );
      await page.mouse.up();
      await page.keyboard.up('Alt');

      await expect.poll(async () => (await getState(page)).pool[0].cropX)
         .not.toBeCloseTo(0.5, 2);
      expect((await getState(page)).sheets[0].placement).toEqual(placementBefore);

      const positions = await filledCells.evaluateAll((els) =>
         els.map((el) => el.style.backgroundPosition));
      expect(new Set(positions).size).toBe(1);
      expect(positions[0]).not.toBe('50% 50%');

      // Una copia nueva después del crop hereda el mismo encuadre.
      await cells.nth(2).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Pegar aquí' }).click();
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(3);
      const lastSize = await cells.nth(2).evaluate((el) => el.style.backgroundSize);
      expect(lastSize).toContain('150%');

      // El plan de exportación lleva el crop al PDF.
      const plan = await getExportPlan(page);
      expect(plan[0].items[0].cropScale).toBeCloseTo(1.5, 2);

      // Persistencia en IndexedDB: tras recargar, el asset conserva su crop.
      await page.waitForTimeout(500);
      await page.reload();
      await waitForLayouts(page);

      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(3);
      const restored = await getState(page);
      expect(restored.pool[0].cropScale).toBeCloseTo(1.5, 2);
      expect(restored.pool[0].cropX).not.toBeCloseTo(0.5, 2);

      const restoredSizes = await page.locator(
         'slice-layouts-section slice-sheet-cell .sheetcell--img'
      ).evaluateAll((els) => els.map((el) => el.style.backgroundSize));
      for (const size of restoredSizes) expect(size).toContain('150%');
   });
});
