/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import SheetStorage from './SheetStorage.js';

/** Doble mínimo de StorageService (misma API get/set/remove). */
function fakeStorage() {
   const map = new Map();
   return {
      map,
      get: vi.fn((key, fallback = null) => (map.has(key) ? map.get(key) : fallback)),
      set: vi.fn((key, value) => {
         map.set(key, value);
         return true;
      }),
      remove: vi.fn((key) => {
         map.delete(key);
         return true;
      })
   };
}

const STATE = {
   activeId: 's1',
   zoom: 0.8,
   sheets: [{ id: 's1', placement: {} }]
};

/** Doble mínimo de IndexedDbManager (API store(name) + promesas). */
function fakeDb(items = []) {
   const map = new Map(items.map((item) => [item.id, item]));
   const api = {
      get: vi.fn((id) => Promise.resolve(map.get(id) || null)),
      getAll: vi.fn(() => Promise.resolve([...map.values()])),
      put: vi.fn((item) => {
         map.set(item.id, { ...(map.get(item.id) || {}), ...item });
         return Promise.resolve(item.id);
      }),
      delete: vi.fn((id) => {
         map.delete(id);
         return Promise.resolve();
      }),
      clear: vi.fn(() => {
         map.clear();
         return Promise.resolve();
      })
   };
   return {
      map,
      api,
      store: vi.fn(() => api)
   };
}

describe('SheetStorage con StorageService', () => {
   it('guarda y lee la estructura con get/set', () => {
      const storage = fakeStorage();
      const svc = new SheetStorage({ storage });

      expect(svc.saveLayout(STATE)).toBe(true);
      expect(storage.set).toHaveBeenCalledWith(
         'sheet-layout',
         expect.objectContaining({ activeId: 's1', zoom: 0.8 })
      );

      const loaded = svc.loadLayout();
      expect(loaded.activeId).toBe('s1');
      expect(loaded.zoom).toBe(0.8);
      expect(loaded.sheets).toHaveLength(1);
   });

   it('flush guarda el pendiente y pagehide lo fuerza sincrónicamente', () => {
      const storage = fakeStorage();
      const svc = new SheetStorage({ storage });
      svc.init();

      svc.scheduleSave(STATE);
      expect(storage.set).not.toHaveBeenCalled();

      window.dispatchEvent(new Event('pagehide'));
      expect(storage.set).toHaveBeenCalledTimes(1);
      expect(storage.set.mock.calls[0][0]).toBe('sheet-layout');

      svc.beforeDestroy();
   });

   it('marca el storage como no disponible si set devuelve false', () => {
      const storage = fakeStorage();
      storage.set.mockReturnValue(false);
      const svc = new SheetStorage({ storage });

      expect(svc.saveLayout(STATE)).toBe(false);
      expect(svc.available).toBe(false);
   });

   it('emite saving, saved y error por evento', () => {
      const emit = vi.fn();
      const previous = globalThis.slice;
      globalThis.slice = { events: { emit } };

      try {
         const storage = fakeStorage();
         const svc = new SheetStorage({ storage });

         svc.scheduleSave(STATE);
         expect(emit).toHaveBeenCalledWith('sheet:save', { status: 'saving', message: '' });

         svc.flush();
         expect(emit).toHaveBeenCalledWith('sheet:save', { status: 'saved', message: '' });

         storage.set.mockReturnValue(false);
         svc.saveLayout(STATE);
         expect(emit).toHaveBeenLastCalledWith(
            'sheet:save',
            expect.objectContaining({ status: 'error' })
         );
      } finally {
         globalThis.slice = previous;
      }
   });

   it('ignora un layout de una versión distinta', () => {
      const storage = fakeStorage();
      const svc = new SheetStorage({ storage });
      storage.map.set('sheet-layout', { version: 999, sheets: [{ id: 'x' }] });

      expect(svc.loadLayout()).toBeNull();
   });

   it('restaura el crop global guardado con el asset', async () => {
      const db = fakeDb([{
         id: 'a1',
         name: 'foto',
         w: 100,
         h: 80,
         quantity: 2,
         cropScale: 1.7,
         cropX: 0.3,
         cropY: 0.7,
         blob: new Blob(['x'])
      }]);
      const poolService = {
         createAssetDirect: vi.fn(({ id, name, w, h, url }) => ({
            id, name, pxW: w, pxH: h, url
         }))
      };

      const previous = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => 'blob:a1');
      try {
         const svc = new SheetStorage({ db, poolService });
         const pool = await svc.loadPool();

         expect(pool[0]).toMatchObject({
            id: 'a1',
            quantity: 2,
            cropScale: 1.7,
            cropX: 0.3,
            cropY: 0.7
         });
      } finally {
         URL.createObjectURL = previous;
      }
   });

   it('guarda el crop del asset sin reescribir el blob', async () => {
      const db = fakeDb([{ id: 'a1', name: 'foto', blob: 'blob-data' }]);
      const svc = new SheetStorage({ db });

      await svc.updateAssetCrop('a1', { cropScale: 2, cropX: 0.2, cropY: 0.8 });

      expect(db.api.put).toHaveBeenCalledWith(expect.objectContaining({
         id: 'a1',
         cropScale: 2,
         cropX: 0.2,
         cropY: 0.8,
         blob: 'blob-data'
      }));
   });

   it('avisa proactivamente cuando la cuota de IndexedDB está casi llena', async () => {
      const emit = vi.fn();
      const previous = globalThis.slice;
      globalThis.slice = { events: { emit } };

      const descriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');
      Object.defineProperty(navigator, 'storage', {
         configurable: true,
         value: {
            estimate: vi.fn(async () => ({ usage: 95, quota: 100 }))
         }
      });

      try {
         const db = fakeDb([{ id: 'a1' }]);
         const svc = new SheetStorage({ db });
         await svc.saveAsset(
            { id: 'a1', name: 'foto.png', pxW: 10, pxH: 10 },
            new Blob(['x'])
         );

         expect(emit).toHaveBeenCalledWith(
            'sheet:save',
            expect.objectContaining({ status: 'warning', message: expect.stringContaining('poco espacio') })
         );
      } finally {
         if (descriptor) Object.defineProperty(navigator, 'storage', descriptor);
         else delete navigator.storage;
         globalThis.slice = previous;
      }
   });
});
