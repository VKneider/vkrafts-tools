// SheetService — Gestión de múltiples hojas.
// Crear, eliminar, cambiar hoja activa, sincronizar configuración.
// Sin estado de UI — opera sobre objetos hoja planos.

export default class SheetService {
   constructor(props = {}) {
      this._tpl = props.templatesService;
   }

   /**
    * Crea una hoja nueva heredando configuración de la hoja actual.
    * @param {number} seq — número de secuencia
    * @param {object} [current] — hoja de la que copiar config
    * @returns {object} hoja nueva
    */
   createSheet(seq, current) {
      const fresh = this._tpl.createSheet(seq);
      if (current) {
         fresh.pageId = current.pageId;
         fresh.templateId = current.templateId;
         fresh.presetId = current.presetId;
         fresh.fitMode = current.fitMode;
         fresh.imageScale = current.imageScale;
      }
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
