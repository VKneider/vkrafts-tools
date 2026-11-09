import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import {
   gotoLayouts,
   uploadImages,
   getState,
   getExportPlan,
   pngSize,
   pdfMediaBoxes,
   inflatedPdfStreams,
   readDownload,
   PAGE_W_MM,
   PAGE_H_MM,
   PX_PER_MM,
   RASTER_SCALE
} from './helpers.js';

const PT_PER_MM = 72 / 25.4;

test.describe('Exportación e impresión a tamaño real', () => {
   test('el PDF usa el tamaño de página y las medidas exactas de cada celda', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      const plan = await getExportPlan(page);
      expect(plan[0].widthMm).toBe(PAGE_W_MM);
      expect(plan[0].heightMm).toBe(PAGE_H_MM);
      expect(plan[0].items).toHaveLength(1);
      const item = plan[0].items[0];

      const [download] = await Promise.all([
         page.waitForEvent('download', { timeout: 60_000 }),
         page.getByRole('button', { name: 'PDF', exact: true }).click()
      ]);

      expect(download.suggestedFilename()).toBe('vkrafts-hojas.pdf');
      const buffer = readDownload(await download.path());
      expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');

      // MediaBox en puntos: Carta = 216 × 279 mm.
      const boxes = pdfMediaBoxes(buffer);
      expect(boxes).toHaveLength(1);
      expect(boxes[0][2]).toBeCloseTo(PAGE_W_MM * PT_PER_MM, 0);
      expect(boxes[0][3]).toBeCloseTo(PAGE_H_MM * PT_PER_MM, 0);

      // La imagen se estampa como XObject nativo (120 × 90), no rasterizada
      // a tamaño de página (eso sería el fallback exportPDFRaster).
      const pdfText = buffer.toString('latin1');
      expect(pdfText).toMatch(/\/Subtype\s*\/Image/);
      expect(pdfText).toMatch(/\/Width\s+120\b/);
      expect(pdfText).toMatch(/\/Height\s+90\b/);

      // El operador `cm` del stream de contenido confirma el tamaño físico de
      // la imagen en puntos (mm del plan × 72/25.4).
      const content = inflatedPdfStreams(buffer);
      const matrices = [...content.matchAll(
         /([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) cm/g
      )].map((m) => m.slice(1).map(Number));

      const expectedW = item.wMm * PT_PER_MM;
      const expectedH = item.hMm * PT_PER_MM;
      const expectedX = item.xMm * PT_PER_MM;
      // PDF tiene origen abajo-izquierda; el plan viene en mm desde arriba.
      const expectedY = (PAGE_H_MM - item.yMm - item.hMm) * PT_PER_MM;
      const placed = matrices.find(
         (m) =>
            Math.abs(m[0] - expectedW) < 0.5 &&
            Math.abs(m[3] - expectedH) < 0.5 &&
            Math.abs(m[4] - expectedX) < 0.5 &&
            Math.abs(m[5] - expectedY) < 0.5
      );
      expect(
         placed,
         `No se encontró la matriz ${expectedW}×${expectedH} pt en (${expectedX}, ${expectedY}). ` +
         `Matrices: ${JSON.stringify(matrices)}`
      ).toBeTruthy();
   });

   test('el PDF agrega una página por hoja con contenido', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      // Duplicar crea otra hoja con la misma imagen colocada.
      await page.getByRole('button', { name: /Duplicar/ }).click();
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip'))
         .toHaveCount(2);

      const [download] = await Promise.all([
         page.waitForEvent('download', { timeout: 60_000 }),
         page.getByRole('button', { name: 'PDF', exact: true }).click()
      ]);

      const boxes = pdfMediaBoxes(readDownload(await download.path()));
      expect(boxes).toHaveLength(2);
      for (const box of boxes) {
         expect(box[2]).toBeCloseTo(PAGE_W_MM * PT_PER_MM, 0);
         expect(box[3]).toBeCloseTo(PAGE_H_MM * PT_PER_MM, 0);
      }
   });

   test('el PNG conserva la proporción de la página y la escala de impresión', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      const [download] = await Promise.all([
         page.waitForEvent('download', { timeout: 60_000 }),
         page.getByRole('button', { name: 'PNGs', exact: true }).click()
      ]);

      expect(download.suggestedFilename()).toBe('hoja-1-carta.png');
      const size = pngSize(readDownload(await download.path()));

      const expectedW = PAGE_W_MM * PX_PER_MM * RASTER_SCALE;
      const expectedH = PAGE_H_MM * PX_PER_MM * RASTER_SCALE;
      expect(Math.abs(size.width - expectedW)).toBeLessThan(4);
      expect(Math.abs(size.height - expectedH)).toBeLessThan(4);
      expect(Math.abs(size.width / size.height - PAGE_W_MM / PAGE_H_MM)).toBeLessThan(0.005);
   });

   test('varias hojas se exportan como un único ZIP de PNGs', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      await page.getByRole('button', { name: /Duplicar/ }).click();
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip')).toHaveCount(2);

      const [download] = await Promise.all([
         page.waitForEvent('download', { timeout: 60_000 }),
         page.getByRole('button', { name: 'PNGs', exact: true }).click()
      ]);

      expect(download.suggestedFilename()).toBe('vkrafts-hojas.zip');
      const zip = unzipSync(new Uint8Array(readDownload(await download.path())));
      const names = Object.keys(zip).sort();

      expect(names).toEqual(['hoja-1-carta.png', 'hoja-2-carta.png']);
      for (const name of names) {
         expect(zip[name].subarray(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));
      }
   });

   test('el modal de exportación permite elegir hojas y PDF/PNGs', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      await page.getByRole('button', { name: /Duplicar/ }).click();
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip')).toHaveCount(2);
      await page.getByRole('button', { name: '+ Nueva hoja' }).click();
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip')).toHaveCount(3);

      const openExport = async () => {
         await page.getByRole('button', { name: /Exportar/ }).click();
         const modal = page.locator('slice-export-sheets-modal');
         await expect(modal.getByRole('checkbox')).toHaveCount(3, { timeout: 30_000 });
         return modal;
      };

      let modal = await openExport();
      const boxes = modal.getByRole('checkbox');
      await expect(boxes.nth(0)).toBeChecked();
      await expect(boxes.nth(1)).toBeChecked();
      await expect(boxes.nth(2)).toBeDisabled();
      await expect(modal.locator('.exsm__summary')).toHaveText('2 de 2 hoja(s) con contenido');

      // Solo la primera hoja → PDF de una página.
      await boxes.nth(1).uncheck();
      await expect(modal.locator('.exsm__summary')).toHaveText('1 de 2 hoja(s) con contenido');

      const [pdf] = await Promise.all([
         page.waitForEvent('download', { timeout: 60_000 }),
         modal.getByRole('button', { name: 'PDF', exact: true }).click()
      ]);
      expect(pdfMediaBoxes(readDownload(await pdf.path()))).toHaveLength(1);

      // Con las dos hojas con contenido → ZIP con dos PNGs.
      modal = await openExport();
      const [zipDownload] = await Promise.all([
         page.waitForEvent('download', { timeout: 60_000 }),
         modal.getByRole('button', { name: 'PNGs', exact: true }).click()
      ]);
      const zip = unzipSync(new Uint8Array(readDownload(await zipDownload.path())));
      expect(Object.keys(zip).sort()).toEqual(['hoja-1-carta.png', 'hoja-2-carta.png']);
   });

   test('la impresión usa @page real y celdas medidas en px ≡ mm', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      // Dos hojas para verificar que se importan ambas a la vez.
      await page.getByRole('button', { name: /Duplicar/ }).click();
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip'))
         .toHaveCount(2);

      await page.getByRole('button', { name: 'Imprimir', exact: true }).click();

      const iframe = page.locator('iframe[title="Impresión"]');
      await expect(iframe).toHaveCount(1, { timeout: 30_000 });

      const handle = await iframe.elementHandle();
      const frame = await handle.contentFrame();
      expect(frame).toBeTruthy();
      await frame.waitForSelector('.vk-print-sheet');

      const info = await frame.evaluate(() => {
         const style = document.querySelector('style')?.textContent || '';
         const sheets = [...document.querySelectorAll('.vk-print-sheet')];
         const measured = sheets.map((sheet) => {
            const cs = getComputedStyle(sheet);
            const cell = sheet.querySelector('div');
            return {
               width: parseFloat(cs.width),
               height: parseFloat(cs.height),
               background: cell ? getComputedStyle(cell).backgroundImage : ''
            };
         });
         return {
            count: sheets.length,
            style,
            measured,
            printed: window.__printCalls || 0
         };
      });

      expect(info.count).toBe(2);
      expect(info.style).toContain(`size: ${PAGE_W_MM}mm ${PAGE_H_MM}mm`);
      expect(info.style).toContain('margin: 0');
      for (const sheet of info.measured) {
         expect(sheet.width).toBeCloseTo(PAGE_W_MM * PX_PER_MM, 0);
         expect(sheet.height).toBeCloseTo(PAGE_H_MM * PX_PER_MM, 0);
         expect(sheet.background).toContain('blob:');
      }
      expect(info.printed).toBeGreaterThanOrEqual(1);

      // La app limpia el iframe con afterprint o a los 60 s; en el test no hay
      // diálogo nativo, así que lo retiramos para no dejarlo colgado.
      await page.evaluate(() => {
         document.querySelector('iframe[title="Impresión"]')?.remove();
      });
   });

   test('las hojas vacías se omiten al exportar e imprimir', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      // Dos hojas con contenido y una tercera vacía.
      await page.getByRole('button', { name: /Duplicar/ }).click();
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip'))
         .toHaveCount(2);
      await page.getByRole('button', { name: '+ Nueva hoja' }).click();
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip'))
         .toHaveCount(3);

      // PDF: solo las dos hojas con imágenes, sin página en blanco.
      const [pdf] = await Promise.all([
         page.waitForEvent('download', { timeout: 60_000 }),
         page.getByRole('button', { name: 'PDF', exact: true }).click()
      ]);
      expect(pdfMediaBoxes(readDownload(await pdf.path()))).toHaveLength(2);

      // PNGs: ZIP con dos archivos, la hoja vacía no aparece.
      const [zipDownload] = await Promise.all([
         page.waitForEvent('download', { timeout: 60_000 }),
         page.getByRole('button', { name: 'PNGs', exact: true }).click()
      ]);
      const zip = unzipSync(new Uint8Array(readDownload(await zipDownload.path())));
      expect(Object.keys(zip).sort()).toEqual(['hoja-1-carta.png', 'hoja-2-carta.png']);

      // Impresión: solo se montan dos hojas en el iframe.
      await page.getByRole('button', { name: 'Imprimir', exact: true }).click();
      const iframe = page.locator('iframe[title="Impresión"]');
      await expect(iframe).toHaveCount(1, { timeout: 30_000 });

      const frame = await (await iframe.elementHandle()).contentFrame();
      await frame.waitForSelector('.vk-print-sheet');
      expect(await frame.locator('.vk-print-sheet').count()).toBe(2);

      await page.evaluate(() => {
         document.querySelector('iframe[title="Impresión"]')?.remove();
      });
   });

   test('Ctrl+Shift+E y Ctrl+Shift+P exportan solo la hoja activa', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      await page.getByRole('button', { name: /Duplicar/ }).click();
      await expect(page.locator('slice-layouts-section .layoutssection__sheetchip'))
         .toHaveCount(2);

      // Duplicar activa la copia; volvemos a la primera hoja.
      const chips = page.locator('slice-layouts-section .layoutssection__sheetchip');
      await chips.first().locator('.layoutssection__sheetchip-main').click();

      const firstId = (await getState(page)).sheets[0].id;
      await expect.poll(async () => (await getState(page)).activeId).toBe(firstId);

      // Ctrl+Shift+E = PDF solo de la hoja activa.
      const [pdf] = await Promise.all([
         page.waitForEvent('download', { timeout: 60_000 }),
         page.keyboard.press('Control+Shift+E')
      ]);
      expect(pdfMediaBoxes(readDownload(await pdf.path()))).toHaveLength(1);

      // Ctrl+Shift+P = impresión solo de la hoja activa.
      await page.keyboard.press('Control+Shift+P');
      const iframe = page.locator('iframe[title="Impresión"]');
      await expect(iframe).toHaveCount(1, { timeout: 30_000 });

      const frame = await (await iframe.elementHandle()).contentFrame();
      await frame.waitForSelector('.vk-print-sheet');
      expect(await frame.locator('.vk-print-sheet').count()).toBe(1);

      await page.evaluate(() => {
         document.querySelector('iframe[title="Impresión"]')?.remove();
      });
   });

   test('doble click en PDF no dispara dos exportaciones', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      let downloads = 0;
      page.on('download', () => { downloads += 1; });

      // Alarga la carga para que el segundo click llegue con _exporting=true.
      await page.evaluate(() => {
         const el = document.querySelector('slice-layouts-section');
         const original = el._exportSvc._loadImage.bind(el._exportSvc);
         el._exportSvc._loadImage = async (...args) => {
            await new Promise((resolve) => setTimeout(resolve, 300));
            return original(...args);
         };
      });

      const pdf = page.getByRole('button', { name: 'PDF', exact: true });
      await pdf.click();
      await page.waitForTimeout(80);
      await pdf.click({ force: true });

      await expect.poll(() => downloads, { timeout: 60_000 }).toBe(1);
      await page.waitForTimeout(800);
      expect(downloads).toBe(1);
   });

   test('si ninguna imagen se puede leer, el PDF cae al raster', async ({ page }) => {
      await gotoLayouts(page);
      await uploadImages(page, 1);
      await expect(page.locator('slice-sheet-cell .sheetcell--img')).toHaveCount(1);

      // Fuerza el fallo de decodificación que dispara exportPDFRaster().
      await page.evaluate(() => {
         const el = document.querySelector('slice-layouts-section');
         el._exportSvc._loadImage = async () => null;
      });

      const [download] = await Promise.all([
         page.waitForEvent('download', { timeout: 60_000 }),
         page.getByRole('button', { name: 'PDF', exact: true }).click()
      ]);

      const boxes = pdfMediaBoxes(readDownload(await download.path()));
      expect(boxes).toHaveLength(1);
      expect(boxes[0][2]).toBeCloseTo(PAGE_W_MM * PT_PER_MM, 0);
      expect(boxes[0][3]).toBeCloseTo(PAGE_H_MM * PT_PER_MM, 0);
   });
});
