import { describe, it, expect, beforeEach } from 'vitest';
import PlacementService from './PlacementService.js';
import SheetGeometry from '../SheetGeometry/SheetGeometry.js';

describe('PlacementService', () => {
   let geom;
   let svc;

   beforeEach(() => {
      geom = new SheetGeometry();
      svc = new PlacementService({ geomService: geom });
   });

   describe('freeSlots', () => {
      it('retorna todos los slots si placement está vacío', () => {
         const sheet = { placement: {} };
         expect(svc.freeSlots(sheet, 4)).toEqual([0, 1, 2, 3]);
      });

      it('retorna solo slots libres', () => {
         const sheet = { placement: { 0: { refId: 'a' }, 2: { refId: 'b' } } };
         expect(svc.freeSlots(sheet, 4)).toEqual([1, 3]);
      });

      it('retorna array vacío si todo está ocupado', () => {
         const sheet = { placement: { 0: {}, 1: {}, 2: {}, 3: {} } };
         expect(svc.freeSlots(sheet, 4)).toEqual([]);
      });
   });

   describe('fitFor', () => {
      it('modo smart: cover si ratio similar', () => {
         expect(svc.fitFor(1.0, 1.0, 'smart')).toBe('cover');
      });

      it('modo smart: contain si ratio muy diferente', () => {
         expect(svc.fitFor(0.5, 2.0, 'smart')).toBe('contain');
      });

      it('modo cover siempre retorna cover', () => {
         expect(svc.fitFor(0.1, 10, 'cover')).toBe('cover');
      });

      it('modo contain siempre retorna contain', () => {
         expect(svc.fitFor(10, 0.1, 'contain')).toBe('contain');
      });
   });

   describe('smartAssign', () => {
      it('asigna assets a slots por orden de área', () => {
         const assets = [
            { id: 'small', area: 100, ratio: 1, orient: 'square' },
            { id: 'large', area: 1000, ratio: 1, orient: 'square' }
         ];
         const sheet = { placement: {}, fitMode: 'smart' };
         const queue = svc.smartAssign(assets, sheet, 2, 1.0);

         expect(queue).toHaveLength(2);
         expect(queue[0].refId).toBe('large');
         expect(queue[1].refId).toBe('small');
      });

      it('limita a la capacidad de la hoja', () => {
         const assets = Array.from({ length: 10 }, (_, i) => ({
            id: `img-${i}`, area: i * 100, ratio: 1, orient: 'square'
         }));
         const sheet = { placement: {}, fitMode: 'smart' };
         const queue = svc.smartAssign(assets, sheet, 4, 1.0);

         expect(queue).toHaveLength(4);
      });

      it('prioriza orientación similar', () => {
         const assets = [
            { id: 'landscape', area: 500, ratio: 2, orient: 'landscape' }
         ];
         const sheet = { placement: {}, fitMode: 'smart' };
         const queue = svc.smartAssign(assets, sheet, 4, 2.0);

         expect(queue).toHaveLength(1);
         expect(queue[0].fit).toBe('cover');
      });
   });

   describe('fillGradually', () => {
      it('llena slots vacíos primero', () => {
         const assets = [
            { id: 'a', area: 100, ratio: 1, orient: 'square' }
         ];
         const sheet = { placement: { 0: { refId: 'x' } }, fitMode: 'smart' };
         const queue = svc.fillGradually(assets, sheet, 4, 1.0);

         expect(queue).toHaveLength(1);
         expect(queue[0].slot).toBe(1);
      });

      it('retorna vacío si no hay slots libres', () => {
         const assets = [{ id: 'a', area: 100, ratio: 1, orient: 'square' }];
         const sheet = { placement: { 0: {}, 1: {}, 2: {}, 3: {} }, fitMode: 'smart' };
         const queue = svc.fillGradually(assets, sheet, 4, 1.0);
         expect(queue).toHaveLength(0);
      });
   });

   describe('fillNextFree', () => {
      it('retorna step para el primer slot libre', () => {
         const asset = { id: 'a', ratio: 1.5 };
         const sheet = { placement: { 0: {} }, fitMode: 'smart' };
         const step = svc.fillNextFree(asset, sheet, 4, 1.0);

         expect(step).toEqual({
            slot: 1,
            refId: 'a',
            fit: expect.any(String)
         });
      });

      it('retorna null si no hay slots', () => {
         const asset = { id: 'a', ratio: 1 };
         const sheet = { placement: { 0: {}, 1: {}, 2: {}, 3: {} } };
         expect(svc.fillNextFree(asset, sheet, 4, 1)).toBeNull();
      });
   });

   describe('cleanupPlacement', () => {
      it('remueve placements que exceden capacidad', () => {
         const sheet = {
            placement: { 0: { refId: 'a' }, 1: { refId: 'b' }, 5: { refId: 'c' } }
         };
         const cleaned = svc.cleanupPlacement(sheet, 4);
         expect(Object.keys(cleaned.placement)).toEqual(['0', '1']);
      });
   });

   describe('clearPlacements', () => {
      it('vacía el placement', () => {
         const sheet = { placement: { 0: { refId: 'a' } } };
         expect(svc.clearPlacements(sheet).placement).toEqual({});
      });
   });

   describe('removePlacement', () => {
      it('elimina un slot específico', () => {
         const sheet = { placement: { 0: { refId: 'a' }, 1: { refId: 'b' } } };
         const result = svc.removePlacement(sheet, 0);
         expect(result.placement).toEqual({ 1: { refId: 'b' } });
      });
   });

   describe('placeInSlot', () => {
      it('coloca un asset en un slot', () => {
         const sheet = { placement: {} };
         const result = svc.placeInSlot(sheet, 2, 'img-1', 'cover');
         expect(result.placement[2]).toEqual({ refId: 'img-1', fit: 'cover' });
      });
   });

   describe('removeAssetFromAllSheets', () => {
      it('remueve un asset de todas las hojas', () => {
         const sheets = [
            { id: 's1', placement: { 0: { refId: 'a' }, 1: { refId: 'b' } } },
            { id: 's2', placement: { 0: { refId: 'a' } } }
         ];
         const result = svc.removeAssetFromAllSheets(sheets, 'a');
         expect(result[0].placement).toEqual({ 1: { refId: 'b' } });
         expect(result[1].placement).toEqual({});
      });
   });

   describe('usedAssetIds', () => {
      it('retorna Set de IDs usados', () => {
         const sheet = { placement: { 0: { refId: 'a' }, 2: { refId: 'b' } } };
         expect(svc.usedAssetIds(sheet)).toEqual(new Set(['a', 'b']));
      });

      it('retorna Set vacío si placement vacío', () => {
         expect(svc.usedAssetIds({ placement: {} })).toEqual(new Set());
      });
   });
});
