import { describe, it, expect, beforeEach } from 'vitest';
import SheetService from './SheetService.js';
import LayoutTemplates from '../LayoutTemplates/LayoutTemplates.js';

describe('SheetService', () => {
   let templates;
   let svc;

   beforeEach(() => {
      templates = new LayoutTemplates();
      svc = new SheetService({ templatesService: templates });
   });

   describe('createSheet', () => {
      it('crea una hoja con la secuencia dada', () => {
         const sheet = svc.createSheet(3);
         expect(sheet.id).toMatch(/^sheet-3-/);
         expect(sheet.pageId).toBe('carta');
         expect(sheet.templateId).toBe('m2x2');
      });

      it('hereda configuración de la hoja actual', () => {
         const current = {
            pageId: 'a4',
            templateId: 'm3x3',
            presetId: 'wide',
            fitMode: 'contain'
         };
         const sheet = svc.createSheet(2, current);
         expect(sheet.pageId).toBe('a4');
         expect(sheet.templateId).toBe('m3x3');
         expect(sheet.presetId).toBe('wide');
         expect(sheet.fitMode).toBe('contain');
      });

      it('hereda escala, producto y pesos de columnas/filas sin compartir referencias', () => {
         const current = {
            pageId: 'a4',
            templateId: 'grid-3x5',
            presetId: 'compact',
            fitMode: 'cover',
            imageScale: 0.7,
            productId: 'sticker-5',
            cellSizeMm: { w: 50, h: 50 },
            cols: [2, 1, 1],
            rows: [1, 1, 1, 1, 1]
         };
         const sheet = svc.createSheet(2, current);

         expect(sheet.imageScale).toBe(0.7);
         expect(sheet.productId).toBe('sticker-5');
         expect(sheet.cellSizeMm).toEqual({ w: 50, h: 50 });
         expect(sheet.cols).toEqual([2, 1, 1]);
         expect(sheet.rows).toEqual([1, 1, 1, 1, 1]);

         // Copia profunda: mover un splitter en la hoja nueva no puede deformar
         // la original.
         sheet.cellSizeMm.w = 40;
         sheet.cols[0] = 9;
         expect(current.cellSizeMm.w).toBe(50);
         expect(current.cols[0]).toBe(2);
      });

      it('la hoja nueva arranca sin contenido', () => {
         const current = { pageId: 'a4', templateId: 'm3x3', placement: { 0: { refId: 'a' } } };
         const sheet = svc.createSheet(2, current);
         expect(sheet.placement).toEqual({});
      });
   });

   describe('removeSheet', () => {
      it('elimina una hoja y mantiene la activa si no era la eliminada', () => {
         const sheets = [
            { id: 's1' }, { id: 's2' }, { id: 's3' }
         ];
         const result = svc.removeSheet(sheets, 's2', 's3');
         expect(result.sheets).toHaveLength(2);
         expect(result.activeId).toBe('s2');
      });

      it('cambia la activa si se elimina la hoja activa', () => {
         const sheets = [
            { id: 's1' }, { id: 's2' }, { id: 's3' }
         ];
         const result = svc.removeSheet(sheets, 's2', 's2');
         expect(result.sheets).toHaveLength(2);
         expect(result.activeId).toBe('s1');
      });

      it('retorna activeId undefined si se eliminan todas', () => {
         const result = svc.removeSheet([{ id: 's1' }], 's1', 's1');
         expect(result.sheets).toHaveLength(0);
         expect(result.activeId).toBeUndefined();
      });
   });

   describe('getActiveSheet', () => {
      it('retorna la hoja activa', () => {
         const state = {
            activeId: 's2',
            sheets: [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
         };
         expect(svc.getActiveSheet(state)).toEqual({ id: 's2' });
      });

      it('retorna la primera hoja si activeId no existe', () => {
         const state = {
            activeId: 'missing',
            sheets: [{ id: 's1' }, { id: 's2' }]
         };
         expect(svc.getActiveSheet(state)).toEqual({ id: 's1' });
      });
   });

   describe('getCapacity', () => {
      it('retorna cols * rows del template', () => {
         expect(svc.getCapacity('m2x2')).toBe(4);
         expect(svc.getCapacity('m3x3')).toBe(9);
         expect(svc.getCapacity('x1')).toBe(1);
      });
   });

   describe('createInitialState', () => {
      it('crea estado con una hoja y pool vacío', () => {
         const state = svc.createInitialState();
         expect(state.sheets).toHaveLength(1);
         expect(state.pool).toEqual([]);
         expect(state.activeId).toBe(state.sheets[0].id);
      });
   });

   describe('mutateActiveSheet', () => {
      it('aplica mutator solo a la hoja activa', () => {
         const state = {
            activeId: 's2',
            sheets: [
               { id: 's1', presetId: 'none', placement: {} },
               { id: 's2', presetId: 'normal', placement: {} }
            ]
         };
         const result = svc.mutateActiveSheet(state, (s) => ({
            ...s, presetId: 'wide'
         }));
         expect(result.sheets[0].presetId).toBe('none');
         expect(result.sheets[1].presetId).toBe('wide');
      });
   });

   describe('setActive', () => {
      it('cambia la hoja activa', () => {
         const state = { activeId: 's1', sheets: [{ id: 's1' }, { id: 's2' }] };
         const result = svc.setActive(state, 's2');
         expect(result.activeId).toBe('s2');
      });
   });

   describe('getSheet', () => {
      it('retorna hoja por ID', () => {
         const state = { sheets: [{ id: 'a' }, { id: 'b' }] };
         expect(svc.getSheet(state, 'b')).toEqual({ id: 'b' });
      });

      it('retorna null si no existe', () => {
         expect(svc.getSheet({ sheets: [] }, 'x')).toBeNull();
      });
   });

   describe('sheetCount', () => {
      it('cuenta hojas', () => {
         expect(svc.sheetCount({ sheets: [1, 2, 3] })).toBe(3);
         expect(svc.sheetCount({ sheets: [] })).toBe(0);
      });
   });
});
