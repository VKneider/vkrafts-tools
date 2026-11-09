import fs from 'node:fs';
import zlib from 'node:zlib';
import { expect } from '@playwright/test';

export const PAGE_W_MM = 216; // Carta
export const PAGE_H_MM = 279;
export const PX_PER_MM = 96 / 25.4;
export const RASTER_SCALE = 3; // ExportService.RASTER_SCALE

// ── PNG de prueba ───────────────────────────────────────────────────────────
// Se genera en memoria para que el E2E no dependa de fixtures binarios.

const CRC_TABLE = (() => {
   const table = new Uint32Array(256);
   for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
   }
   return table;
})();

function crc32(buf) {
   let c = 0xffffffff;
   for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
   return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
   const len = Buffer.alloc(4);
   len.writeUInt32BE(data.length);
   const typeBuf = Buffer.from(type, 'latin1');
   const crc = Buffer.alloc(4);
   crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
   return Buffer.concat([len, typeBuf, data, crc]);
}

/** PNG RGB sólido, sin dependencias. */
export function makePng(width, height, color = [210, 70, 70]) {
   const [r, g, b] = color;
   const stride = width * 3 + 1;
   const raw = Buffer.alloc(stride * height);
   for (let y = 0; y < height; y++) {
      const row = y * stride;
      raw[row] = 0; // filtro None
      for (let x = 0; x < width; x++) {
         const p = row + 1 + x * 3;
         raw[p] = r;
         raw[p + 1] = g;
         raw[p + 2] = b;
      }
   }

   const ihdr = Buffer.alloc(13);
   ihdr.writeUInt32BE(width, 0);
   ihdr.writeUInt32BE(height, 4);
   ihdr[8] = 8; // bit depth
   ihdr[9] = 2; // color type RGB

   return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', zlib.deflateSync(raw)),
      pngChunk('IEND', Buffer.alloc(0))
   ]);
}

// HEIC mínimo (80×60, color sólido) para probar la conversión con heic2any.
// Se genera una sola vez y se embebe como base64: no hace falta un fixture
// binario ni una herramienta externa en la máquina que corre los tests.
const HEIC_SAMPLE_BASE64 = [
   'AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAX1tZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0',
   'AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABoQABAAAAAAAAACQAAAAjaWluZgAAAAAAAQAA',
   'ABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA/WlwcnAAAADdaXBjbwAAAHZodmNDAQNwAAAA',
   'kAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQAqQgEBA3AAAAMAkAAA',
   'AwAAAwAeoCiBBZbq5Ka5uAhoMCAAAAMDIAAAAwAhYgABAAZEAcFzwYkAAAATY29scm5jbHgAAQANAAaAAAAA',
   'FGlzcGUAAAAAAAAAUAAAAEAAAAAoY2xhcAAAAFAAAAABAAAAPAAAAAEAAAAAAAAAAv////wAAAACAAAAEHBpeGkA',
   'AAAAAwgICAAAABhpcG1hAAAAAAAAAAEAAQWBAgMFhAAAACxtZGF0AAAAICgBrxNFlPUngT//mdR/+x7nh9es',
   'F+d93vrBYfNKtc14'
].join('');

/** Buffer HEIC real (80×60) para probar la conversión. */
export function makeHeic() {
   return Buffer.from(HEIC_SAMPLE_BASE64, 'base64');
}

// ── Navegación / setup ─────────────────────────────────────────────────────

/**
 * Abre /layouts y espera a que la sección haya terminado su init.
 * También neutraliza window.print: en headless no hay diálogo nativo y
 * la vista de impresión se inspecciona por el iframe que crea ExportService.
 */
export async function gotoLayouts(page) {
   await page.addInitScript(() => {
      window.print = function () {
         window.__printCalls = (window.__printCalls || 0) + 1;
      };
   });

   await page.goto('/layouts', { waitUntil: 'domcontentloaded' });
   await waitForLayouts(page);
}

/** Espera a que la sección exista y haya terminado su init (también tras reload). */
export async function waitForLayouts(page) {
   await page.locator('slice-layouts-section .layoutssection__sheet')
      .waitFor({ state: 'attached', timeout: 30_000 });
   await page.waitForFunction(() => {
      const el = document.querySelector('slice-layouts-section');
      return !!(el && el._panel && el._sheet?.());
   }, null, { timeout: 30_000 });
}

/** Sube `count` PNGs por el input real de la vista y espera el contador. */
export async function uploadImages(
   page,
   count,
   { width = 120, height = 90, total = count } = {}
) {
   const files = Array.from({ length: count }, (_, i) => ({
      name: `e2e-${String(i).padStart(2, '0')}.png`,
      mimeType: 'image/png',
      buffer: makePng(width, height, [40 + ((i * 37) % 200), 80, 170])
   }));

   await page.locator('slice-layouts-section input[data-ref="picker"]').setInputFiles(files);
   await expect(page.locator(
      'slice-layouts-panel .layoutspanel__gallery-head .layoutspanel__label'
   )).toHaveText(`Biblioteca (${total})`, { timeout: 30_000 });
}

/** Rect de una celda en mm reales (descontando el zoom de la vista). */
export async function cellMetrics(page, slot) {
   return page.evaluate((index) => {
      const el = document.querySelector('slice-layouts-section');
      const zoom = el._state.zoom ?? 0.7;
      const sheet = el.$refs.sheet;
      const sheetBox = sheet.getBoundingClientRect();
      const cell = sheet.querySelectorAll('slice-sheet-cell')[index];
      const box = cell.getBoundingClientRect();
      const pxPerMm = 96 / 25.4;
      return {
         // Relativas a la hoja: no dependen del scroll de la página.
         left: box.left - sheetBox.left,
         top: box.top - sheetBox.top,
         widthPx: box.width,
         heightPx: box.height,
         wMm: box.width / zoom / pxPerMm,
         hMm: box.height / zoom / pxPerMm
      };
   }, slot);
}

/** Plan de exportación en mm que consume el PDF exacto. */
export async function getExportPlan(page) {
   return page.evaluate(() => {
      const el = document.querySelector('slice-layouts-section');
      return el._buildExportPlan(el._state.sheets);
   });
}

/** Estado serializable del módulo para aserciones. */
export async function getState(page) {
   return page.evaluate(() => {
      const el = document.querySelector('slice-layouts-section');
      const state = el._state;
      return {
         zoom: state.zoom,
         activeId: state.activeId,
         pool: state.pool.map((asset) => ({
            id: asset.id,
            name: asset.name,
            quantity: asset.quantity ?? 1,
            cropScale: asset.cropScale ?? 1,
            cropX: asset.cropX ?? 0.5,
            cropY: asset.cropY ?? 0.5
         })),
         sheets: state.sheets.map((sheet) => ({
            id: sheet.id,
            name: sheet.name ?? null,
            templateId: sheet.templateId,
            pageId: sheet.pageId,
            presetId: sheet.presetId,
            productId: sheet.productId ?? null,
            fitMode: sheet.fitMode,
            imageScale: sheet.imageScale,
            cellSizeMm: sheet.cellSizeMm ?? null,
            cols: sheet.cols ?? null,
            rows: sheet.rows ?? null,
            colSizesMm: sheet.colSizesMm ?? null,
            rowSizesMm: sheet.rowSizesMm ?? null,
            placement: { ...(sheet.placement || {}) }
         }))
      };
   });
}

/** Geometría de la hoja activa, en mm. */
export async function getGeometry(page) {
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

/** Click en una celda con imagen y verifica que quede seleccionada. */
export async function selectCell(page, slot) {
   const cell = page.locator('slice-layouts-section slice-sheet-cell')
      .nth(slot)
      .locator('.sheetcell');
   await cell.click();
   await expect(cell).toHaveClass(/sheetcell--selected/);
}

/** Ajusta la cantidad de copias de una PoolCard con sus botones reales. */
export async function setQuantity(page, cardIndex, quantity) {
   const card = page.locator('slice-pool-card').nth(cardIndex);
   const increase = card.getByRole('button', { name: 'Más copias' });
   for (let i = 1; i < quantity; i++) await increase.click();
   await expect(card.locator('.poolcard__qty-value')).toHaveText(`×${quantity}`);
}

/** Abre el menú contextual de una celda y aplica "Editar medidas…". */
export async function editCellMeasures(page, slot, { widthCm, heightCm } = {}) {
   const cell = page.locator('slice-layouts-section slice-sheet-cell')
      .nth(slot)
      .locator('.sheetcell');
   await cell.click({ button: 'right' });
   await page.getByRole('menuitem', { name: /Editar medidas/ }).click();

   const widthInput = page.getByLabel('Ancho de columna (cm)');
   await widthInput.waitFor({ state: 'visible' });
   if (widthCm !== undefined) await widthInput.fill(String(widthCm));
   if (heightCm !== undefined) await page.getByLabel('Alto de fila (cm)').fill(String(heightCm));

   await page.locator('slice-cell-size-modal')
      .getByRole('button', { name: 'Aplicar' })
      .click();
   await expect(widthInput).toBeHidden({ timeout: 10_000 });
}

// ── Lectura de archivos exportados ─────────────────────────────────────────

/** Dimensiones del PNG desde el IHDR. */
export function pngSize(buffer) {
   const signature = buffer.subarray(1, 4).toString('latin1');
   if (signature !== 'PNG') throw new Error('El archivo no es un PNG');
   return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
   };
}

/** MediaBox de todas las páginas de un PDF, en puntos. */
export function pdfMediaBoxes(buffer) {
   const text = buffer.toString('latin1');
   const boxes = [];
   for (const match of text.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)) {
      const nums = match[1].trim().split(/\s+/).map(Number);
      if (nums.length === 4 && nums.every((n) => Number.isFinite(n))) boxes.push(nums);
   }
   return boxes;
}

/** Infla los streams Flate del PDF para leer los operadores de contenido. */
export function inflatedPdfStreams(buffer) {
   const text = buffer.toString('latin1');
   const parts = [];
   for (const match of text.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      const raw = Buffer.from(match[1], 'latin1');
      try {
         parts.push(zlib.inflateSync(raw).toString('latin1'));
      } catch {
         // Stream binario (imagen) o compresión distinta: se ignora.
      }
   }
   return parts.join('\n');
}

export function readDownload(path) {
   return fs.readFileSync(path);
}
