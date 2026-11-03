// SheetService — Gestión de múltiples hojas.
// Crear, eliminar, cambiar hoja activa, sincronizar configuración.
// Sin estado de UI — opera sobre objetos hoja planos.

/**
 * Configuración de una hoja (todo lo que no es contenido).
 * @typedef {object} SheetConfig
 * @property {string} [pageId]
 * @property {string} [templateId]
 * @property {string} [presetId]
 * @property {string} [fitMode]
 * @property {number} [imageScale]
 * @property {string|null} [productId]
 * @property {{w:number, h:number}|null} [cellSizeMm]
 * @property {number[]} [cols]
 * @property {number[]} [rows]
 */

export default class SheetService {
   constructor(props = {}) {
      this._tpl = props.templatesService;
   }

   /**
    * Crea una hoja nueva heredando la configuración de la hoja actual.
    *
    * Hereda **todo lo que define cómo se ve la hoja** —papel, plantilla,
    * márgenes, ajuste, escala, tamaño fijo de producto y los pesos de
    * columnas/filas— pero **no el contenido**: `placement` arranca vacío. Copiar
    * con imágenes es `duplicateSheet`, que es otra acción.
    *
    * Los arrays de pesos y `cellSizeMm` se copian: compartir la referencia hacía
    * que mover un splitter en la hoja nueva deformara también la original.
    *
    * @param {number} seq - número de secuencia
    * @param {SheetConfig} [current] - hoja de la que copiar config
    * @returns {object} hoja nueva
    */
   createSheet(seq, current) {
      const fresh = this._tpl.createSheet(seq);
      if (!current) return fresh;

      fresh.pageId = current.pageId ?? fresh.pageId;
      fresh.templateId = current.templateId ?? fresh.templateId;
      fresh.presetId = current.presetId ?? fresh.presetId;
      fresh.fitMode = current.fitMode ?? fresh.fitMode;
      fresh.imageScale = current.imageScale ?? fresh.imageScale;

      // Tamaño fijo de producto: sin esto "Nueva hoja" volvía a la grilla
      // elástica y perdía las celdas de 5×5 cm, por ejemplo.
      fresh.productId = current.productId ?? null;
      fresh.cellSizeMm = current.cellSizeMm ? { ...current.cellSizeMm } : null;

      // Pesos por columna/fila de los splitters. Se validan contra la plantilla
      // al calcular la geometría, así que copiarlos de más no rompe nada.
      fresh.cols = Array.isArray(current.cols) ? [...current.cols] : undefined;
      fresh.rows = Array.isArray(current.rows) ? [...current.rows] : undefined;

      return fresh;
   }

   /**
    * Elimina una hoja y retorna el nuevo estado.
    * Si se elimina la activa, selecciona la primera disponible.
    * @param {object[]} sheets
    * @param {string} activeId
    * @param {string} id — ID a eliminar
    * @returns {{sheets:object[], activeId:string}}
    */
   removeSheet(sheets, activeId, id) {
      const filtered = sheets.filter((sh) => sh.id !== id);
      return {
         sheets: filtered,
         activeId: activeId === id ? filtered[0]?.id : activeId
      };
   }

   /**
    * Obtiene la hoja activa del estado.
    */
   getActiveSheet(state) {
      return state.sheets.find((sh) => sh.id === state.activeId) || state.sheets[0];
   }

   /**
    * Capacidad total de una hoja (cols × rows).
    */
   getCapacity(templateId) {
      const tpl = this._tpl.get(templateId);
      return tpl.cols * tpl.rows;
   }

   /**
    * Inicializa el estado del contexto con una hoja por defecto.
    */
   createInitialState() {
      const sheet = this._tpl.createSheet(1);
      return {
         activeId: sheet.id,
         sheets: [sheet],
         pool: []
      };
   }

   /**
    * Aplica un mutator a la hoja activa.
    * @param {object} state — estado actual
    * @param {function} mutator — (sheet) => sheet
    * @returns {object} nuevo estado
    */
   mutateActiveSheet(state, mutator) {
      return {
         ...state,
         sheets: state.sheets.map((sh) =>
            sh.id === state.activeId ? mutator({ ...sh, placement: { ...sh.placement } }) : sh
         )
      };
   }

   /**
    * Actualiza el estado completo.
    */
   updateState(state, updater) {
      return updater(state);
   }

   /**
    * Cambia la hoja activa.
    */
   setActive(state, activeId) {
      return { ...state, activeId };
   }

   /**
    * Obtiene la hoja por ID.
    */
   getSheet(state, id) {
      return state.sheets.find((sh) => sh.id === id) || null;
   }

   /**
    * Cuenta el total de hojas.
    */
   sheetCount(state) {
      return state.sheets.length;
   }
}
