// PlacementService — Algoritmos de colocación de imágenes en celdas.
// Decide qué imagen va en qué celda y con qué ajuste (cover/contain).
// Sin estado de UI, sin DOM — pura lógica algorítmica.

export default class PlacementService {
   constructor(props = {}) {
      this._geom = props.geomService;
   }

   /**
    * Slots vacíos de una hoja.
    * @param {object} sheet — hoja con placement {}
    * @param {number} capacity — cols * rows
    * @returns {number[]} índices libres
    */
   freeSlots(sheet, capacity) {
      const free = [];
      for (let i = 0; i < capacity; i++) {
         if (!sheet.placement[i]) free.push(i);
      }
      return free;
   }

   /**
    * Resuelve ajuste según modo de la hoja.
    */
   fitFor(imgRatio, cellRatio, mode) {
      return this._geom.fitFor(imgRatio, cellRatio, mode);
   }

   /**
    * Ratio de aspecto de una celda individual (para slots no uniformes).
    * Actualmente retorna el fallback (celdas uniformes).
    */
   slotRatio(_sheet, _slot, fallback) {
      return fallback;
   }

   /**
    * Auto-asignación inteligente: ordena pool por área (mayor primero),
    * asigna a la celda que mejor encaja por proporción y orientación.
    * @param {object[]} assets — pool de assets
    * @param {object} sheet — hoja actual
    * @param {number} capacity — total de celdas
    * @param {number} cellRatio — ratio de celda promedio
    * @returns {{slot:number, refId:string, fit:string}[]} cola de colocación
    */
   smartAssign(assets, sheet, capacity, cellRatio) {
      const sorted = [...assets]
         .sort((a, b) => b.area - a.area)
         .slice(0, capacity);

      const slots = Array.from({ length: capacity }, (_, i) => i);
      const queue = [];

      for (const asset of sorted) {
         if (!slots.length) break;
         const rated = slots.map((s) => ({
            s,
            score: this._geom.fitScore(asset.ratio, cellRatio)
               + (this._geom.orientation(cellRatio) === asset.orient ? 0 : 0.6)
         }));
         rated.sort((a, b) => a.score - b.score);
         const chosen = rated[0].s;
         slots.splice(slots.indexOf(chosen), 1);
         queue.push({
            slot: chosen,
            refId: asset.id,
            fit: this.fitFor(asset.ratio, cellRatio, sheet.fitMode)
         });
      }

      return queue;
   }

   /**
    * Colocación gradual: llena slots vacíos priorizando orientación similar.
    * @param {object[]} assets — assets a colocar (IDs)
    * @param {object} sheet — hoja con placement
    * @param {number} capacity — total de celdas
    * @param {number} cellRatio — ratio de celda
    * @returns {{slot:number, refId:string, fit:string}[]} cola de colocación
    */
   fillGradually(assets, sheet, capacity, cellRatio) {
      const free = this.freeSlots(sheet, capacity);
      const refs = assets.filter(Boolean).sort((a, b) => b.area - a.area);

      const queue = [];
      const remaining = new Set(free);

      for (const asset of refs) {
         if (!remaining.size) break;
         const sameOrient = [...remaining].filter((slot) => {
            const cR = this.slotRatio(sheet, slot, cellRatio);
            return this._geom.orientation(cR) === asset.orient;
         });
         const poolSlots = sameOrient.length ? sameOrient : [...remaining];
         const slot = poolSlots.reduce((best, s) => {
            const rB = this.slotRatio(sheet, s, cellRatio);
            const rBest = this.slotRatio(sheet, best, cellRatio);
            return this._geom.fitScore(asset.ratio, rB) < this._geom.fitScore(asset.ratio, rBest) ? s : best;
         });
         remaining.delete(slot);
         queue.push({
            slot,
            refId: asset.id,
            fit: this.fitFor(asset.ratio, this.slotRatio(sheet, slot, cellRatio), sheet.fitMode)
         });
      }

      return queue;
   }

   /**
    * Llena el siguiente slot libre con un asset.
    */
   fillNextFree(asset, sheet, capacity, cellRatio) {
      const free = this.freeSlots(sheet, capacity);
      if (!free.length) return null;
      const slot = free[0];
      return {
         slot,
         refId: asset.id,
         fit: this.fitFor(asset.ratio, this.slotRatio(sheet, slot, cellRatio), sheet.fitMode)
      };
   }

   /**
    * Remueve placements que exceden la capacidad de la hoja.
    */
   cleanupPlacement(sheet, capacity) {
      const placement = { ...sheet.placement };
      Object.keys(placement).forEach((k) => {
         if (Number(k) >= capacity) delete placement[k];
      });
      return { ...sheet, placement };
   }

   /**
    * Remueve todas las imágenes de las celdas (placement vacío).
    */
   clearPlacements(sheet) {
      return { ...sheet, placement: {} };
   }

   /**
    * Remueve el placement de un slot específico.
    */
   removePlacement(sheet, slot) {
      const placement = { ...sheet.placement };
      delete placement[slot];
      return { ...sheet, placement };
   }

   /**
    * Coloca una imagen en un slot específico.
    */
   placeInSlot(sheet, slot, refId, fit) {
      return {
         ...sheet,
         placement: { ...sheet.placement, [slot]: { refId, fit } }
      };
   }

   /**
    * Revierte placements de un asset específico de TODAS las hojas.
    */
   removeAssetFromAllSheets(sheets, assetId) {
      return sheets.map((sh) => {
         const placement = { ...sh.placement };
         Object.keys(placement).forEach((k) => {
            if (placement[k].refId === assetId) delete placement[k];
         });
         return { ...sh, placement };
      });
   }

   /**
    * Cuenta cuántas imágenes del pool están en la hoja activa.
    */
   countUsedInSheet(sheet) {
      return Object.values(sheet.placement || {}).length;
   }

   /**
    * IDs de assets usados en una hoja.
    */
   usedAssetIds(sheet) {
      return new Set(
         Object.values(sheet.placement || {}).map((p) => p.refId)
      );
   }
}
