/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExportService from './ExportService.js';
import LayoutTemplates from '../LayoutTemplates/LayoutTemplates.js';

describe('ExportService', () => {
   let templates;
   let svc;

   beforeEach(() => {
      templates = new LayoutTemplates();
      svc = new ExportService({ templatesService: templates });
   });

   describe('renderOffscreen', () => {
      it('crea contenedores temporales para cada hoja', async () => {
         const sheets = [
            { id: 's1', pageId: 'carta' },
            { id: 's2', pageId: 'a4' }
         ];
         const renderFn = vi.fn().mockResolvedValue(undefined);

         const stages = await svc.renderOffscreen(sheets, renderFn);

         expect(stages).toHaveLength(2);
         expect(renderFn).toHaveBeenCalledTimes(2);
         stages.forEach((s) => {
            expect(s.tmp).toBeInstanceOf(HTMLElement);
            expect(s.tmp.style.position).toBe('fixed');
         });
      });

      it('limpia contenedores con cleanupStages', async () => {
         const stages = await svc.renderOffscreen([{ pageId: 'carta' }], vi.fn());
         const removeSpy = vi.spyOn(stages[0].tmp, 'remove');

         svc.cleanupStages(stages);
         expect(removeSpy).toHaveBeenCalled();
      });
   });

   describe('exportPNGs', () => {
      it('genera y descarga PNGs', async () => {
         const mockCanvas = {
            toDataURL: vi.fn().mockReturnValue('data:image/png;base64,abc')
         };
         const html2canvas = vi.fn().mockResolvedValue(mockCanvas);

         const stages = [
            { sheet: { pageId: 'carta' }, tmp: document.createElement('div') },
            { sheet: { pageId: 'a4' }, tmp: document.createElement('div') }
         ];

         const clickSpy = vi.fn();
         vi.spyOn(document, 'createElement').mockReturnValue({ click: clickSpy, href: '', download: '' });

         const count = await svc.exportPNGs(stages, html2canvas);

         expect(count).toBe(2);
         expect(html2canvas).toHaveBeenCalledTimes(2);
         expect(clickSpy).toHaveBeenCalledTimes(2);

         vi.restoreAllMocks();
      });
   });

   describe('exportPDF', () => {
      it('genera un PDF con todas las hojas', async () => {
         const mockCanvas = {
            toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,xyz')
         };
         const html2canvas = vi.fn().mockResolvedValue(mockCanvas);

         const mockPdf = {
            addPage: vi.fn(),
            save: vi.fn(),
            addImage: vi.fn()
         };
         class MockJsPDF {
            constructor() { Object.assign(this, mockPdf); }
         }

         const stages = [
            { sheet: { pageId: 'carta' }, tmp: document.createElement('div') }
         ];

         const result = await svc.exportPDF(stages, html2canvas, MockJsPDF);

         expect(result).toBe(true);
         expect(mockPdf.addImage).toHaveBeenCalled();
         expect(mockPdf.save).toHaveBeenCalledWith('vkrafts-hojas.pdf');
      });

      it('retorna false si no hay hojas', async () => {
         const result = await svc.exportPDF([], vi.fn(), vi.fn());
         expect(result).toBe(false);
      });
   });

   describe('printSheet', () => {
      it('abre ventana nueva y ejecuta print', async () => {
         const sheetEl = document.createElement('div');
         sheetEl.textContent = 'test';

         const mockPrintWindow = {
            document: {
               write: vi.fn(),
               close: vi.fn(),
               body: { appendChild: vi.fn() }
            },
            print: vi.fn(),
            close: vi.fn()
         };
         vi.spyOn(window, 'open').mockReturnValue(mockPrintWindow);
         vi.useFakeTimers();
         vi.spyOn(window, 'print').mockImplementation(() => {});

         svc.printSheet(sheetEl);

         expect(window.open).toHaveBeenCalled();
         expect(mockPrintWindow.document.write).toHaveBeenCalled();
         expect(mockPrintWindow.document.close).toHaveBeenCalled();

         vi.advanceTimersByTime(300);
         expect(mockPrintWindow.print).toHaveBeenCalled();

         vi.useRealTimers();
         vi.restoreAllMocks();
      });

      it('no falla si window.open retorna null', () => {
         const sheetEl = document.createElement('div');
         vi.spyOn(window, 'open').mockReturnValue(null);

         expect(() => svc.printSheet(sheetEl)).not.toThrow();

         vi.restoreAllMocks();
      });
   });
});
