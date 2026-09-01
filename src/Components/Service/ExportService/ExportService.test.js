/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ExportService from './ExportService.js';
import LayoutTemplates from '../LayoutTemplates/LayoutTemplates.js';

/** Canvas mínimo con la interfaz que consume ExportService. */
function mockCanvas({ withBlob = true } = {}) {
   return {
      width: 100,
      height: 100,
      toDataURL: vi.fn().mockReturnValue('data:image/png;base64,abc'),
      toBlob: withBlob
         ? vi.fn((cb) => cb(new Blob(['x'], { type: 'image/png' })))
         : undefined
   };
}

function stageOf(pageId) {
   const node = document.createElement('div');
   return { sheet: { pageId }, host: document.createElement('div'), node };
}

describe('ExportService', () => {
   let templates;
   let svc;

   beforeEach(() => {
      templates = new LayoutTemplates();
      svc = new ExportService({ templatesService: templates });

      // jsdom no implementa createObjectURL.
      if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:mock');
      if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
   });

   afterEach(() => {
      vi.restoreAllMocks();
      document.body.replaceChildren();
   });

   describe('renderOffscreen', () => {
      it('crea un host fuera de pantalla y un nodo de hoja por cada hoja', async () => {
         const sheets = [
            { id: 's1', pageId: 'carta' },
            { id: 's2', pageId: 'a4' }
         ];
         const renderFn = vi.fn().mockResolvedValue(undefined);

         const stages = await svc.renderOffscreen(sheets, renderFn);

         expect(stages).toHaveLength(2);
         expect(renderFn).toHaveBeenCalledTimes(2);
         stages.forEach((s) => {
            expect(s.host).toBeInstanceOf(HTMLElement);
            expect(s.node).toBeInstanceOf(HTMLElement);
            // El host es la cáscara posicionada; el nodo capturado va dentro.
            expect(s.host.style.position).toBe('fixed');
            expect(s.node.parentElement).toBe(s.host);
         });
      });

      it('le pasa a renderFn el nodo de la hoja, no el host', async () => {
         const renderFn = vi.fn().mockResolvedValue(undefined);
         const stages = await svc.renderOffscreen([{ pageId: 'carta' }], renderFn);

         expect(renderFn).toHaveBeenCalledWith(
            expect.objectContaining({ pageId: 'carta' }),
            stages[0].node
         );
      });

      it('limpia los hosts con cleanupStages', async () => {
         const stages = await svc.renderOffscreen([{ pageId: 'carta' }], vi.fn());
         expect(stages[0].host.isConnected).toBe(true);

         svc.cleanupStages(stages);
         expect(stages[0].host.isConnected).toBe(false);
      });

      it('cleanupStages tolera null', () => {
         expect(() => svc.cleanupStages(null)).not.toThrow();
      });
   });

   describe('exportPNGs', () => {
      it('genera y descarga un PNG por hoja', async () => {
         const html2canvas = vi.fn().mockResolvedValue(mockCanvas());
         const clickSpy = vi
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => {});

         const stages = [stageOf('carta'), stageOf('a4')];
         const count = await svc.exportPNGs(stages, html2canvas);

         expect(count).toBe(2);
         expect(html2canvas).toHaveBeenCalledTimes(2);
         expect(clickSpy).toHaveBeenCalledTimes(2);
      });

      it('reporta progreso', async () => {
         const html2canvas = vi.fn().mockResolvedValue(mockCanvas());
         vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
         const onProgress = vi.fn();

         await svc.exportPNGs([stageOf('carta')], html2canvas, { onProgress });

         expect(onProgress).toHaveBeenCalledWith(0, 1);
         expect(onProgress).toHaveBeenLastCalledWith(1, 1);
      });

      it('cae a toDataURL si el canvas no soporta toBlob', async () => {
         const canvas = mockCanvas({ withBlob: false });
         const html2canvas = vi.fn().mockResolvedValue(canvas);
         vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

         await svc.exportPNGs([stageOf('carta')], html2canvas);

         expect(canvas.toDataURL).toHaveBeenCalledWith('image/png', 1.0);
      });
   });

   describe('exportPDFExact', () => {
      let pdfSpy;
      let MockJsPDF;
      let received;

      beforeEach(() => {
         received = null;
         pdfSpy = { addPage: vi.fn(), save: vi.fn(), addImage: vi.fn() };
         MockJsPDF = class {
            constructor(opts) {
               received = opts;
               Object.assign(this, pdfSpy);
            }
         };
         // Las imágenes no cargan en jsdom: se resuelven sin red.
         vi.spyOn(svc, '_loadImage').mockResolvedValue({
            naturalWidth: 400,
            naturalHeight: 300
         });
      });

      const page = (items) => ({ widthMm: 210, heightMm: 297, items });
      const item = (over = {}) => ({
         url: 'blob:x', name: 'foto.jpg', cellRatio: 1,
         xMm: 10, yMm: 20, wMm: 50, hMm: 50, crop: false, ...over
      });

      it('usa el tamaño de página real y no fuerza orientación', async () => {
         await svc.exportPDFExact([page([])], MockJsPDF);
         expect(received.unit).toBe('mm');
         expect(received.format).toEqual([210, 297]);
         // El formato explícito ya define la orientación; pasarla además hace
         // que jsPDF intercambie los lados.
         expect(received.orientation).toBeUndefined();
      });

      it('estampa cada imagen en sus coordenadas en milímetros', async () => {
         await svc.exportPDFExact([page([item({ xMm: 12.5, yMm: 30, wMm: 50, hMm: 70 })])], MockJsPDF);

         const [, , x, y, w, h] = pdfSpy.addImage.mock.calls[0];
         expect([x, y, w, h]).toEqual([12.5, 30, 50, 70]);
      });

      it('agrega una página por hoja', async () => {
         await svc.exportPDFExact([page([item()]), page([item()])], MockJsPDF);
         expect(pdfSpy.addPage).toHaveBeenCalledTimes(1);
         expect(pdfSpy.addImage).toHaveBeenCalledTimes(2);
         expect(pdfSpy.save).toHaveBeenCalledWith('vkrafts-hojas.pdf');
      });

      it('conserva la transparencia de un PNG', async () => {
         await svc.exportPDFExact([page([item({ name: 'sticker.png' })])], MockJsPDF);
         expect(pdfSpy.addImage.mock.calls[0][1]).toBe('PNG');
      });

      it('usa JPEG para fotos', async () => {
         await svc.exportPDFExact([page([item({ name: 'foto.jpg' })])], MockJsPDF);
         expect(pdfSpy.addImage.mock.calls[0][1]).toBe('JPEG');
      });

      it('retorna false si no hay hojas', async () => {
         expect(await svc.exportPDFExact([], MockJsPDF)).toBe(false);
         expect(await svc.exportPDFExact(null, MockJsPDF)).toBe(false);
      });
   });

   describe('exportCalibrationSheet', () => {
      it('genera la hoja con el tamaño de página pedido', () => {
         let received = null;
         const api = {
            text: vi.fn(), line: vi.fn(), rect: vi.fn(),
            setFontSize: vi.fn(), setLineWidth: vi.fn(), save: vi.fn()
         };
         class MockJsPDF {
            constructor(opts) { received = opts; Object.assign(this, api); }
         }

         expect(svc.exportCalibrationSheet(MockJsPDF, 'carta')).toBe(true);
         expect(received.format).toEqual([216, 279]);
         // Regla de 100mm: una línea base + 11 marcas cada 10mm.
         expect(api.line).toHaveBeenCalledTimes(12);
         expect(api.rect).toHaveBeenCalledWith(20, expect.any(Number), 50, 50);
         expect(api.save).toHaveBeenCalledWith('vkrafts-calibracion.pdf');
      });
   });

   describe('printSheets', () => {
      it('monta un iframe con una página por hoja y el @page del tamaño real', () => {
         vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);

         const stages = [stageOf('a4'), stageOf('a4')];
         stages.forEach((s) => (s.node.textContent = 'hoja'));

         const ok = svc.printSheets(stages);

         expect(ok).toBe(true);
         const frame = document.querySelector('iframe');
         expect(frame).not.toBeNull();

         const doc = frame.contentDocument;
         expect(doc.head.querySelector('style').textContent)
            .toContain('size: 210mm 297mm');
         expect(doc.body.querySelectorAll('.vk-print-sheet')).toHaveLength(2);
      });

      it('neutraliza el transform de preview en las hojas importadas', () => {
         vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);

         const stage = stageOf('carta');
         stage.node.style.transform = 'scale(0.7)';

         svc.printSheets([stage]);

         const printed = document
            .querySelector('iframe')
            .contentDocument.querySelector('.vk-print-sheet');
         expect(printed.style.transform).toBe('none');
      });

      it('retorna false si no hay hojas', () => {
         expect(svc.printSheets([])).toBe(false);
         expect(svc.printSheets(null)).toBe(false);
      });
   });

   describe('waitForImages', () => {
      it('resuelve de inmediato si no hay imágenes de fondo', async () => {
         await expect(svc.waitForImages(document.createElement('div')))
            .resolves.toBeUndefined();
      });
   });
});
