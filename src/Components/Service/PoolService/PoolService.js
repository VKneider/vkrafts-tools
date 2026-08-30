// PoolService — Gestión del pool de imágenes (biblioteca).
// CRUD puro de assets: creación, medición, eliminación y búsqueda.
// Sin estado de UI, sin DOM — testeable con mocks de Image/URL.

export default class PoolService {
   constructor() {
      this._seq = 0;
   }

   /** ID incremental único para cada asset. */
   nextId() {
      return `img-${++this._seq}-${Date.now()}`;
   }

   /**
    * Mide una imagen por URL (blob URL o remota).
    * @param {string} url
    * @returns {Promise<{w:number, h:number}|null>}
    */
   measure(url) {
      return new Promise((resolve) => {
         const img = new Image();
         img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
         img.onerror = () => resolve(null);
         img.src = url;
      });
   }

   /**
    * Crea un asset a partir de un archivo + dimensiones medidas.
    * @param {File} file
    * @param {{w:number, h:number}} size
    * @param {string} [id] — override para testing
    * @returns {object|null} asset o null si size es inválido
    */
   createAsset(file, size, id) {
      if (!size || !(size.w > 0) || !(size.h > 0)) return null;
      const ratio = size.w / size.h;
      return {
         id: id || this.nextId(),
         name: file?.name || 'imagen',
         url: URL.createObjectURL(file),
         ratio,
         pxW: size.w,
         pxH: size.h,
         orient: ratio > 1 ? 'landscape' : ratio < 1 ? 'portrait' : 'square',
         area: size.w * size.h
      };
   }

   /**
    * Crea un asset directo (sin File) — útil para testing y datos serializados.
    */
   createAssetDirect({ id, name = 'imagen', url, w, h }) {
      if (!url || !(w > 0) || !(h > 0)) return null;
      const ratio = w / h;
      return {
         id: id || this.nextId(),
         name,
         url,
         ratio,
         pxW: w,
         pxH: h,
         orient: ratio > 1 ? 'landscape' : ratio < 1 ? 'portrait' : 'square',
         area: w * h
      };
   }

   /**
    * Elimina un asset del pool y revoca su Object URL.
    * @param {object[]} pool
    * @param {string} id
    * @returns {object[]} nuevo pool
    */
   removeAsset(pool, id) {
      const target = pool.find((p) => p.id === id);
      if (target?.url?.startsWith?.('blob:')) {
         URL.revokeObjectURL(target.url);
      }
      return pool.filter((p) => p.id !== id);
   }

   /**
    * Busca un asset por ID en el pool.
    */
   findById(pool, id) {
      return pool.find((p) => p.id === id) || null;
   }

   /**
    * Limpia todos los Object URLs del pool.
    */
   disposeAll(pool) {
      for (const asset of pool) {
         if (asset.url?.startsWith?.('blob:')) {
            URL.revokeObjectURL(asset.url);
         }
      }
   }
}
