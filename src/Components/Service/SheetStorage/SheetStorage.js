// SheetStorage — Persistencia del módulo Plantillas de Hoja.
//
// El estado se parte en dos porque los medios y la estructura tienen soportes
// distintos:
//   · Los BLOBS de las imágenes van a IndexedDB. Las object URLs (`blob:…`) son
//     válidas solo mientras vive el documento, así que guardarlas no sirve de
//     nada: hay que guardar el binario y regenerar la URL al restaurar.
//   · La ESTRUCTURA (hojas, plantillas, celdas ocupadas, zoom) va a
//     localStorage: es chica, serializable y se lee de forma síncrona.
//
// Los ids de los assets se preservan entre sesiones, así que los `refId` que
// guarda cada celda siguen apuntando a la imagen correcta al restaurar.

const LAYOUT_KEY = 'vkrafts:sheet-layout';
const SAVE_DEBOUNCE_MS = 600;
const SCHEMA_VERSION = 1;

export default class SheetStorage {
   constructor(props = {}) {
      this._db = props.db || null;
      this._local = props.local || null;
      this._pool = props.poolService || null;

      this._saveTimer = 0;
      this._pendingState = null;
      this._available = true;
   }

   /** false si el navegador bloquea el almacenamiento (modo privado, cuota). */
   get available() {
      return this._available;
   }

   // ---------- estructura (localStorage) ----------

   /**
    * Agenda un guardado. Se llama en cada cambio del contexto, así que se
    * agrupa: arrastrar un splitter dispara decenas de commits por segundo.
    * @param {object} state — estado completo del contexto `sheet`
    */
   scheduleSave(state) {
      this._pendingState = state;
      if (this._saveTimer) return;
      this._saveTimer = setTimeout(() => {
         this._saveTimer = 0;
         const pending = this._pendingState;
         this._pendingState = null;
         if (pending) this.saveLayout(pending);
      }, SAVE_DEBOUNCE_MS);
   }

   /** Fuerza el guardado pendiente (al desmontar la vista). */
   flush() {
      if (!this._saveTimer) return;
      clearTimeout(this._saveTimer);
      this._saveTimer = 0;
      const pending = this._pendingState;
      this._pendingState = null;
      if (pending) this.saveLayout(pending);
   }

   /**
    * Guarda la estructura. El `pool` se omite a propósito: sus `url` son object
    * URLs muertas fuera de esta sesión y los binarios ya viven en IndexedDB.
    */
   saveLayout(state) {
      if (!this._local || !state) return false;
      const ok = this._local.setItem(LAYOUT_KEY, {
         version: SCHEMA_VERSION,
         savedAt: Date.now(),
         activeId: state.activeId,
         zoom: state.zoom,
         sheets: state.sheets
      });
      if (!ok) this._available = false;
      return ok;
   }

   /** @returns {{activeId:string, sheets:object[], zoom:number}|null} */
   loadLayout() {
      const raw = this._local?.getItem(LAYOUT_KEY);
      if (!raw || raw.version !== SCHEMA_VERSION) return null;
      if (!Array.isArray(raw.sheets) || !raw.sheets.length) return null;
      return {
         activeId: raw.activeId,
         sheets: raw.sheets,
         zoom: raw.zoom
      };
   }

   // ---------- imágenes (IndexedDB) ----------

   /**
    * Guarda el binario de un asset. Se llama al agregarlo al pool.
    * @param {object} asset — asset ya creado (id, name, pxW, pxH)
    * @param {Blob} blob — el File original
    */
   async saveAsset(asset, blob) {
      if (!this._db || !asset || !blob) return false;
      try {
         await this._db.updateItem({
            id: asset.id,
            name: asset.name,
            w: asset.pxW,
            h: asset.pxH,
            quantity: asset.quantity ?? 1,
            blob
         });
         return true;
      } catch (err) {
         this._available = false;
         slice.logger?.logWarn?.('SheetStorage', 'No se pudo guardar la imagen', err);
         return false;
      }
   }

   /**
    * Actualiza solo la cantidad de copias, sin volver a escribir el binario.
    * El blob puede pesar megas: reescribirlo por cada click en "+" sería caro.
    */
   async updateAssetQuantity(id, quantity) {
      if (!this._db) return;
      try {
         const item = await this._db.getItem(id);
         if (!item) return;
         await this._db.updateItem({ ...item, quantity });
      } catch (err) {
         slice.logger?.logWarn?.('SheetStorage', 'No se pudo guardar la cantidad', err);
      }
   }

   async deleteAsset(id) {
      if (!this._db) return;
      try {
         await this._db.deleteItem(id);
      } catch (err) {
         slice.logger?.logWarn?.('SheetStorage', 'No se pudo borrar la imagen', err);
      }
   }

   /**
    * Reconstruye el pool desde IndexedDB, regenerando una object URL por asset.
    * @returns {Promise<object[]>}
    */
   async loadPool() {
      if (!this._db || !this._pool) return [];
      try {
         const items = await this._db.getAllItems();
         return items
            .map((item) => {
               if (!item?.blob) return null;
                const asset = this._pool.createAssetDirect({
                   id: item.id,
                   name: item.name,
                   url: URL.createObjectURL(item.blob),
                   w: item.w,
                   h: item.h
                });
                if (asset) asset.quantity = item.quantity ?? 1;
               return asset;
            })
            .filter(Boolean);
      } catch (err) {
         this._available = false;
         slice.logger?.logWarn?.('SheetStorage', 'No se pudo leer la biblioteca', err);
         return [];
      }
   }

   // ---------- restauración / limpieza ----------

   /**
    * Estado completo listo para `context.set`, o null si no hay nada guardado.
    *
    * Descarta las celdas cuyo `refId` ya no exista en la biblioteca: si una
    * imagen se perdió (cuota, borrado manual de la base) la hoja seguiría
    * apuntando a un asset fantasma y la celda quedaría vacía sin explicación.
    */
   async restore() {
      const layout = this.loadLayout();
      const pool = await this.loadPool();
      if (!layout && !pool.length) return null;

      const known = new Set(pool.map((a) => a.id));
      const sheets = (layout?.sheets || []).map((sheet) => {
         const placement = {};
         for (const [slot, ref] of Object.entries(sheet.placement || {})) {
            if (ref && known.has(ref.refId)) placement[slot] = ref;
         }
         return { ...sheet, placement };
      });

      // Si hay imágenes en la biblioteca pero no hay hojas guardadas (o se
      // perdieron), crear una hoja por defecto para que la vista no quede
      // vacía y el usuario vea sus imágenes de una.
      if (!sheets.length && pool.length) {
         sheets.push({
            id: 'sheet-1',
            pageId: 'carta',
            templateId: 'm2x2',
            presetId: 'normal',
            fitMode: 'smart',
            imageScale: 1,
            placement: {}
         });
      }

      if (!sheets.length) return null;

      const activeId = sheets.some((s) => s.id === layout?.activeId)
         ? layout.activeId
         : sheets[0].id;

      return { activeId, sheets, pool, zoom: layout?.zoom };
   }

   /** Vacía solo la biblioteca de imágenes; las hojas siguen guardadas. */
   async clearAssets() {
      try {
         await this._db?.clearItems();
      } catch (err) {
         slice.logger?.logWarn?.('SheetStorage', 'No se pudo vaciar la biblioteca', err);
      }
   }

   // Acá había un `clearAll()` que borraba la biblioteca Y la estructura de
   // hojas. No lo llamaba nadie —la vista usa `clearAssets()`, que conserva las
   // hojas— y convivir con dos métodos de nombre parecido, uno de los cuales
   // borra el doble que el otro, es una trampa para el próximo que lea esto.
   // Si algún día hace falta un "empezar de cero", son `clearAssets()` más
   // `this._local?.removeItem(LAYOUT_KEY)`.

   beforeDestroy() {
      this.flush();
   }
}
