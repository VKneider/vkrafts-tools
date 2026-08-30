import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PoolService from './PoolService.js';

describe('PoolService', () => {
   let svc;

   beforeEach(() => {
      svc = new PoolService();
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock-url');
   });

   afterEach(() => {
      vi.restoreAllMocks();
   });

   describe('nextId', () => {
      it('genera IDs únicos incrementales', () => {
         const id1 = svc.nextId();
         const id2 = svc.nextId();
         expect(id1).toMatch(/^img-\d+-\d+$/);
         expect(id2).not.toBe(id1);
      });
   });

   describe('createAsset', () => {
      it('crea un asset válido con File', () => {
         const file = { name: 'test.jpg' };
         const size = { w: 800, h: 600 };
         const asset = svc.createAsset(file, size, 'test-1');

         expect(asset).toEqual({
            id: 'test-1',
            name: 'test.jpg',
            url: 'blob:mock-url',
            ratio: 800 / 600,
            pxW: 800,
            pxH: 600,
            orient: 'landscape',
            area: 480000
         });
      });

      it('retorna null con size inválido', () => {
         expect(svc.createAsset({ name: 'a.jpg' }, null)).toBeNull();
         expect(svc.createAsset({ name: 'a.jpg' }, { w: 0, h: 100 })).toBeNull();
         expect(svc.createAsset({ name: 'a.jpg' }, { w: 100, h: 0 })).toBeNull();
      });

      it('detecta orientación portrait', () => {
         const asset = svc.createAsset({ name: 'v.jpg' }, { w: 400, h: 800 });
         expect(asset.orient).toBe('portrait');
         expect(asset.ratio).toBe(0.5);
      });

      it('detecta orientación square', () => {
         const asset = svc.createAsset({ name: 's.jpg' }, { w: 500, h: 500 });
         expect(asset.orient).toBe('square');
         expect(asset.ratio).toBe(1);
      });
   });

   describe('createAssetDirect', () => {
      it('crea asset sin File', () => {
         const asset = svc.createAssetDirect({
            id: 'direct-1', name: 'direct', url: 'http://example.com/img.jpg', w: 1024, h: 768
         });
         expect(asset.id).toBe('direct-1');
         expect(asset.name).toBe('direct');
         expect(asset.ratio).toBeCloseTo(1.333);
      });

      it('retorna null con datos faltantes', () => {
         expect(svc.createAssetDirect({})).toBeNull();
         expect(svc.createAssetDirect({ url: 'x', w: 0, h: 100 })).toBeNull();
      });
   });

   describe('removeAsset', () => {
      it('elimina un asset del pool', () => {
         const pool = [
            { id: 'a', url: 'blob:a' },
            { id: 'b', url: 'blob:b' },
            { id: 'c', url: 'blob:c' }
         ];
         const result = svc.removeAsset(pool, 'b');
         expect(result).toHaveLength(2);
         expect(result.map((p) => p.id)).toEqual(['a', 'c']);
      });

      it('revoca Object URLs', () => {
         const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
         const pool = [{ id: 'a', url: 'blob:test' }];
         svc.removeAsset(pool, 'a');
         expect(revokeSpy).toHaveBeenCalledWith('blob:test');
      });

      it('no revoca URLs que no son blob', () => {
         const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
         const pool = [{ id: 'a', url: 'http://example.com/img.jpg' }];
         svc.removeAsset(pool, 'a');
         expect(revokeSpy).not.toHaveBeenCalled();
      });
   });

   describe('findById', () => {
      it('encuentra un asset por ID', () => {
         const pool = [{ id: 'x' }, { id: 'y' }];
         expect(svc.findById(pool, 'y')).toEqual({ id: 'y' });
      });

      it('retorna null si no existe', () => {
         expect(svc.findById([], 'missing')).toBeNull();
      });
   });

   describe('disposeAll', () => {
      it('revoca todas las URLs blob', () => {
         const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
         const pool = [
            { url: 'blob:a' },
            { url: 'blob:b' },
            { url: 'http://c.com' }
         ];
         svc.disposeAll(pool);
         expect(revokeSpy).toHaveBeenCalledTimes(2);
      });
   });
});
