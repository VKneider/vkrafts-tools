import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import heic2any from 'heic2any';

// 1 mm real en píxeles CSS a 96dpi. El valor exacto importa: con la constante
// anterior (3.4) la hoja se renderizaba al ~90% y todo lo impreso/exportado
// salía más chico que el tamaño de papel declarado.
const PX_PER_MM = 96 / 25.4;

const STEP_MS = 140;
const HOLD_DRAG_PX = 10;
const MIN_WEIGHT = 0.15;
const MAX_FILES = 30;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3;
const ZOOM_DEFAULT = 0.7;

// Las celdas se reusan por sliceId entre renders (solo hay una hoja visible).
const cellId = (slot) => `sheet-cell-${slot}`;

export default class LayoutsSection extends HTMLElement {

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$refs = {};
      this.querySelectorAll('[data-ref]').forEach((el) => {
         this.$refs[el.dataset.ref] = el;
      });

      slice.controller.setComponentProps(this, props);
   }

   async init() {
      this._templates = slice.getComponent('LayoutTemplates');
      this._geom = slice.getComponent('SheetGeometry');
      this._toasts = slice.getComponent('ToastProvider');
      this._tips = slice.getComponent('ToolTipProvider');
      this._ctx = slice.context.use('sheet');

      // `singleton: true` devuelve la instancia ya construida si existe, así que
      // esto sirve tanto para crearlas como para recuperarlas (PoolService, por
      // ejemplo, ya lo levantó Providers para SheetStorage).
      this._poolSvc = await slice.build('PoolService', { singleton: true });
      this._placeSvc = await slice.build('PlacementService', { singleton: true, geomService: this._geom });
      this._sheetSvc = await slice.build('SheetService', { singleton: true, templatesService: this._templates });
      this._exportSvc = await slice.build('ExportService', { singleton: true, templatesService: this._templates });
      this._dnd = await slice.build('DragDropService', { singleton: true });

      this._storage = slice.getComponent('SheetStorage');

      this._cmenu = slice.getComponent('app-context-menu');
      if (!this._cmenu) {
         this._cmenu = await slice.build('ContextMenu', { sliceId: 'app-context-menu' });
         if (this._cmenu) document.body.appendChild(this._cmenu);
      }

      this._pendingRefId = null;
      this._placing = false;
      this._exporting = false;
      this._renderSeq = 0;
      this._renderChain = Promise.resolve();
      this._placeChain = Promise.resolve();
      this._lastAnimatedSlot = -1;
      this._dndNodes = new Set();

      // Historial para undo/redo: cada snapshot es una copia profunda del estado.
      this._history = [];
      this._future = [];
      this._historyMax = 50;

      // Clipboard para copiar/pegar placements
      this._clipboard = null;

      // Celda seleccionada para zoom/pan
      this._selectedSlot = null;

      // Restaurar ANTES de construir los controles: el panel se inicializa
      // leyendo la hoja activa, así que tiene que ver ya el estado recuperado.
      await this._restoreSession();

      await this._buildControls();

      // Bind the watcher AFTER _restoreSession + _buildControls so the initial
      // context.set() inside _restoreSession doesn't trigger renderAll() while
      // _panel is still null (which would skip gallery rendering).
      this._watchHandle = this._ctx.bind(this, () => {
         this._storage?.scheduleSave(this._state);
         this.renderAll();
      });
      await this.renderAll();

      document.addEventListener('paste', this._onPaste = (e) => {
         // La sección queda cacheada por el MultiRoute: sin este guard seguiría
         // capturando pegados mientras el usuario está en otra vista.
         if (!this.isConnected) return;
         const files = Array.from(e.clipboardData?.items || [])
            .map((it) => it.getAsFile())
            .filter(Boolean)
            .filter((f) => f.type.startsWith('image/') || this._isHeicFile(f));
         if (files.length) this.addFiles(files);
      });

      document.addEventListener('wheel', this._onWheel = (e) => {
         if (!e.ctrlKey) return;
         if (!e.target.closest?.('slice-layouts-section')) return;
         e.preventDefault();

         const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
         this._zoomBy(Math.exp(-dy * 0.0016));
      }, { passive: false });

      document.addEventListener('keydown', this._onKeyDown = (e) => {
         if (!this.isConnected) return;
         // No interceptar si el foco está en un input, textarea o dialogo
         const tag = e.target?.tagName?.toLowerCase();
         if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
         if (e.target?.closest?.('dialog, slice-modal')) return;

         this._handleShortcut(e);
      });
   }

   update() { return this.renderAll(); }

   /** Recupera la sesión anterior (biblioteca + hojas), si la hay. */
   async _restoreSession() {
      if (!this._storage) {
         slice.logger?.logWarn?.('LayoutsSection', '[restore] SheetStorage no disponible');
         return;
      }

      let restored = null;
      try {
         restored = await this._storage.restore();
      } catch (err) {
         slice.logger?.logWarn?.('LayoutsSection', '[restore] Error en restore()', err);
      }
      if (!restored) return;

      this._ctx.set((prev) => ({
         ...prev,
         activeId: restored.activeId,
         sheets: restored.sheets,
         pool: restored.pool,
         zoom: restored.zoom ?? prev.zoom
      }));

      if (restored.pool.length) {
         this._toasts?.show(
            `Sesión restaurada · ${restored.pool.length} imagen(es) y ${restored.sheets.length} hoja(s)`,
            { type: 'info', duration: 3000 }
         );
      }
   }

   beforeDestroy() {
      // El guardado va con debounce: sin este flush se pierde el último cambio
      // si el usuario navega enseguida.
      this._storage?.flush();

      document.removeEventListener('paste', this._onPaste);
      document.removeEventListener('wheel', this._onWheel);
      document.removeEventListener('keydown', this._onKeyDown);

      if (this._tips) {
         this.querySelectorAll('[data-tooltip]').forEach((el) => this._tips.detach(el));
      }

      for (const node of this._dndNodes) this._dnd?.detach(node);
      this._dndNodes.clear();

      // Las object URLs del pool NO se revocan acá: el pool vive en el contexto
      // 'sheet', que sobrevive a esta sección. Revocarlas dejaba la biblioteca
      // llena de imágenes rotas al volver a entrar a /layouts.
      slice.controller.destroyByContainer(this);
   }

   get _state() { return this._ctx.get(); }

   _sheet() { return this._sheetSvc.getActiveSheet(this._state); }
   _tpl() { return this._templates.get(this._sheet().templateId); }
   _preset() { return this._templates.preset(this._sheet().presetId); }
   _capacity() { return this._sheetSvc.getCapacity(this._sheet().templateId); }
   _asset(refId) { return this._poolSvc.findById(this._state.pool, refId); }

   _commitSheet(mutator) {
      this._ctx.set((prev) => this._sheetSvc.mutateActiveSheet(prev, mutator));
      if (!this._watchHandle) this.renderAll();
   }

   _commitAll(updater) {
      this._ctx.set((prev) => updater(prev));
      if (!this._watchHandle) this.renderAll();
   }

   /** Detecta archivos HEIC/HEIF por extensión o MIME type. */
   _isHeicFile(file) {
      if (!file) return false;
      const name = file.name?.toLowerCase() || '';
      return name.endsWith('.heic') || name.endsWith('.heif')
         || file.type === 'image/heic' || file.type === 'image/heif';
   }

   // ---------- construcción de controles ----------

   async _buildControls() {
      const sheet = this._sheet();

      const actionDefs = [
         { key: 'auto', label: 'Auto acomodar', icon: 'wand-sparkles', variant: 'filled', tip: 'Distribuye automáticamente las imágenes en la hoja', handler: () => this.smartAssign(true) },
         { key: 'clear', label: 'Limpiar hoja', icon: 'trash-2', variant: 'outlined', tip: 'Quita las imágenes de la hoja (quedan en la biblioteca)', handler: () => this.clearPlacements() },
         { key: 'pngs', label: 'PNGs', icon: 'images', variant: 'outlined', tip: 'Descarga como imágenes (para uso digital)', handler: () => this.exportPNGs() },
         { key: 'pdf', label: 'PDF', icon: 'file-text', variant: 'outlined', tip: 'Descarga con medidas exactas (recomendado para imprimir)', handler: () => this.exportPDF() },
         { key: 'print', label: 'Imprimir', icon: 'printer', variant: 'soft', tip: 'Imprimir todas las hojas a tamaño real', handler: () => this.printSheets() }
      ];

      this._panel = await slice.build('LayoutsPanel', {
         sheet,
         templates: this._templates,
         onFiles: (files) => this.addFiles(files),
         actions: actionDefs,
         onPageChange: (pageId) => this._commitSheet((s) => ({ ...s, pageId })),
         onTemplateChange: (t) => this._setTemplate(t),
         onPresetChange: (presetId) => this._commitSheet((s) => ({ ...s, presetId })),
         onFitChange: (fitMode) => this._commitSheet((s) => ({ ...s, fitMode })),
         onScaleChange: (val) => this._setImageScale(val),
         onProductChange: (product) => this._setProduct(product)
      });
      if (this._panel) this.$refs.panel.appendChild(this._panel);

      this.$refs.picker.addEventListener('change', () => {
         const slot = Number(this.$refs.picker.dataset.slot ?? -1);
         this.addFiles(Array.from(this.$refs.picker.files || []), {
            directSlot: slot >= 0 ? slot : null
         });
         this.$refs.picker.value = '';
         delete this.$refs.picker.dataset.slot;
      });

      this.$refs.zoomIn.addEventListener('click', () => this._zoomBy(1.15));
      this.$refs.zoomOut.addEventListener('click', () => this._zoomBy(1 / 1.15));
      this.$refs.zoomInfo.addEventListener('click', () => this._setZoom(ZOOM_DEFAULT));

      // Click en el fondo de la hoja deselecciona la celda activa
      this.$refs.sheet.addEventListener('click', (e) => {
         if (e.target === this.$refs.sheet || e.target.closest('.sheet-grid') === this.$refs.sheet) {
            if (!e.target.closest('slice-sheet-cell')) {
               this._deselectAll();
            }
         }
      });

      this._tips?.scope(this);
   }

   // ---------- zoom ----------

   _zoomBy(factor) {
      this._setZoom((this._state.zoom ?? ZOOM_DEFAULT) * factor);
   }

   _setZoom(value) {
      const prev = this._state.zoom ?? ZOOM_DEFAULT;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
      if (Math.abs(next - prev) < 0.001) return;
      // patch: `set` reemplaza el estado completo y se llevaría pool y hojas.
      this._ctx.patch({ zoom: next });
   }

   // ---------- atajos de teclado ----------

   _handleShortcut(e) {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+Z — Deshacer (restaurar estado anterior del historial)
      if (ctrl && e.key === 'z' && !e.shiftKey) {
         e.preventDefault();
         this._undo();
         return;
      }

      // Ctrl+Y o Ctrl+Shift+Z — Rehacer
      if ((ctrl && e.key === 'y') || (ctrl && e.shiftKey && e.key === 'z')) {
         e.preventDefault();
         this._redo();
         return;
      }

      // Delete / Backspace — Quitar imagen de la celda activa
      if (e.key === 'Delete' || e.key === 'Backspace') {
         e.preventDefault();
         this._removeFromActiveCell();
         return;
      }

      // Ctrl+C — Copiar placement de la celda activa
      if (ctrl && e.key === 'c') {
         e.preventDefault();
         this._copyPlacement();
         return;
      }

      // Ctrl+V — Pegar placement en la celda activa
      if (ctrl && e.key === 'v') {
         e.preventDefault();
         this._pastePlacement();
         return;
      }

      // Ctrl+D — Duplicar hoja
      if (ctrl && e.key === 'd') {
         e.preventDefault();
         this.duplicateSheet(this._state.activeId);
         return;
      }

      // Ctrl+E — Exportar PDF (Ctrl+Shift+E = solo hoja activa)
      if (ctrl && e.key === 'e') {
         e.preventDefault();
         this.exportPDF({ activeOnly: e.shiftKey });
         return;
      }

      // Ctrl+P — Imprimir (Ctrl+Shift+P = solo hoja activa)
      if (ctrl && e.key === 'p') {
         e.preventDefault();
         this.printSheets({ activeOnly: e.shiftKey });
         return;
      }

      // + / - — Zoom
      if (e.key === '+' || e.key === '=') {
         e.preventDefault();
         this._zoomBy(1.15);
         return;
      }
      if (e.key === '-' && !ctrl) {
         e.preventDefault();
         this._zoomBy(1 / 1.15);
         return;
      }

      // 0 — Reset zoom
      if (e.key === '0' && !ctrl) {
         e.preventDefault();
         this._setZoom(ZOOM_DEFAULT);
         return;
      }

      // Escape — Deseleccionar celda
      if (e.key === 'Escape') {
         this._deselectAll();
         return;
      }
   }

   /** Guarda un snapshot del estado actual en el historial (antes de una acción). */
   _pushHistory() {
      const state = this._state;
      this._history.push(JSON.parse(JSON.stringify({
         sheets: state.sheets,
         activeId: state.activeId
      })));
      if (this._history.length > this._historyMax) this._history.shift();
      this._future = [];
   }

   _undo() {
      if (!this._history.length) return;
      const prev = this._history.pop();
      this._future.push(JSON.parse(JSON.stringify({
         sheets: this._state.sheets,
         activeId: this._state.activeId
      })));
      this._ctx.set((s) => ({ ...s, sheets: prev.sheets, activeId: prev.activeId }));
      this._toasts?.show('Deshacer', { type: 'info', duration: 1200 });
   }

   _redo() {
      if (!this._future.length) return;
      const next = this._future.pop();
      this._history.push(JSON.parse(JSON.stringify({
         sheets: this._state.sheets,
         activeId: this._state.activeId
      })));
      this._ctx.set((s) => ({ ...s, sheets: next.sheets, activeId: next.activeId }));
      this._toasts?.show('Rehacer', { type: 'info', duration: 1200 });
   }

   /** Quita la imagen de la celda activa (la celda donde está el foco o la última clickeada). */
   _removeFromActiveCell() {
      // Buscar la última celda clickeada o la primera con imagen
      const cells = this.$refs.sheet?.querySelectorAll('slice-sheet-cell') || [];
      for (const cell of cells) {
         const slot = Number(cell.dataset?.slot ?? cell.querySelector('.sheetcell')?.dataset?.slot);
         if (Number.isFinite(slot) && this._sheet().placement?.[slot]) {
            this._pushHistory();
            this.removePlacement(slot);
            return;
         }
      }
   }

   /** Copia el placement de la primera celda con imagen al clipboard. */
   _copyPlacement() {
      const placement = this._sheet().placement || {};
      for (const [slot, ref] of Object.entries(placement)) {
         if (ref) {
            this._clipboard = { ...ref };
            this._toasts?.show('Placement copiado', { type: 'info', duration: 1200 });
            return;
         }
      }
      this._toasts?.show('No hay imagen que copiar', { type: 'info', duration: 1200 });
   }

   /** Pega el placement copiado en la primera celda vacía. */
   _pastePlacement() {
      if (!this._clipboard) {
         this._toasts?.show('No hay nada pegado', { type: 'info', duration: 1200 });
         return;
      }
      const sheet = this._sheet();
      const tpl = this._templates.get(sheet.templateId);
      const capacity = tpl.cols * tpl.rows;
      const placement = sheet.placement || {};

      // Buscar la primera celda vacía
      for (let slot = 0; slot < capacity; slot++) {
         if (!placement[slot]) {
            this._pushHistory();
            const asset = this._asset(this._clipboard.refId);
            const fit = asset
               ? this._placeSvc.fitFor(asset.ratio, this._cellRatio(sheet), sheet.fitMode)
               : this._clipboard.fit || 'cover';
            this._commitSheet((s) => this._placeSvc.placeInSlot(s, slot, this._clipboard.refId, fit));
            this._toasts?.show('Placement pegado', { type: 'info', duration: 1200 });
            return;
         }
      }
      this._toasts?.show('La hoja está llena', { type: 'warning', duration: 1500 });
   }

   // ---------- pool ----------

   async addFiles(files, { directSlot = null } = {}) {
      const list = Array.from(files || []).slice(0, MAX_FILES);
      const assets = [];

      for (const file of list) {
         if (!file?.type?.startsWith('image/') && !this._isHeicFile(file)) continue;

         let processedFile = file;

         // Convertir HEIC/HEIF a JPEG
         if (this._isHeicFile(file)) {
            try {
               this._toasts?.show('Convirtiendo imagen HEIC…', { type: 'info', duration: 2000 });
               const blob = await heic2any({
                  blob: file,
                  toType: 'image/jpeg',
                  quality: 0.92
               });
               // heic2any puede devolver un array de blobs (animaciones)
               const jpegBlob = Array.isArray(blob) ? blob[0] : blob;
               processedFile = new File(
                  [jpegBlob],
                  file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg'),
                  { type: 'image/jpeg' }
               );
            } catch (err) {
               slice.logger?.logWarn?.('LayoutsSection', 'HEIC conversion failed', err);
               this._toasts?.show('No se pudo convertir la imagen HEIC', { type: 'error' });
               continue;
            }
         }

         const url = URL.createObjectURL(processedFile);
         const size = await this._poolSvc.measure(url);
         if (!size) {
            URL.revokeObjectURL(url);
            continue;
         }
         // Se reusa la MISMA object URL que ya se midió: createAsset() generaba
         // una segunda y la primera quedaba sin revocar en cada carga.
         const asset = this._poolSvc.createAssetDirect({
            name: processedFile.name,
            url,
            w: size.w,
            h: size.h
         });
         if (asset) {
            assets.push(asset);
            // El binario va a IndexedDB para sobrevivir a la recarga; la object
            // URL no sirve fuera de este documento.
            await this._storage?.saveAsset(asset, processedFile);
         } else {
            URL.revokeObjectURL(url);
         }
      }

      if (!assets.length) {
         this._toasts?.show('No se pudo leer ninguna imagen', { type: 'error' });
         return;
      }

      this._ctx.set((prev) => ({ ...prev, pool: [...prev.pool, ...assets] }));

      if (directSlot !== null) {
         const sheet = this._sheet();
         const cellRatio = this._cellRatio(sheet);
         const [first, ...rest] = assets;
         const fit = this._placeSvc.fitFor(first.ratio, cellRatio, sheet.fitMode);
         this._lastAnimatedSlot = directSlot;
         this._commitSheet((s) => this._placeSvc.placeInSlot(s, directSlot, first.id, fit));
         this._lastAnimatedSlot = -1;
         if (rest.length) await this._fillFree(rest);
      } else {
         await this._fillFree(assets);
      }
   }

   /**
    * Elimina una imagen del pool. Es la acción MENOS reversible de la vista:
    * saca la imagen de todas las hojas, revoca su object URL y la borra de
    * IndexedDB — para recuperarla hay que volver a subir el archivo.
    *
    * Se confirma solo si está colocada en alguna hoja, que es cuando además se
    * pierde trabajo de armado. Preguntar por cada miniatura sin usar entrenaría
    * al usuario a aceptar sin leer.
    */
   removeFromPool(id) {
      const asset = this._asset(id);
      const placedIn = this._state.sheets.filter((sh) =>
         this._placeSvc.usedAssetIds(sh).has(id)).length;

      if (!placedIn) return this._doRemoveFromPool(id);

      this._confirm({
         title: 'Eliminar imagen',
         message: `"${asset?.name ?? 'La imagen'}" está colocada en ${placedIn} hoja(s). Se quita de todas y se borra de la biblioteca.`,
         confirmLabel: 'Eliminar',
         danger: true,
         onConfirm: () => this._doRemoveFromPool(id)
      });
   }

   _doRemoveFromPool(id) {
      this._ctx.set((prev) => ({
         ...prev,
         pool: this._poolSvc.removeAsset(prev.pool, id),
         sheets: this._placeSvc.removeAssetFromAllSheets(prev.sheets, id)
      }));
      this._storage?.deleteAsset(id);
      if (this._pendingRefId === id) this._pendingRefId = null;
   }

   /** Pide confirmación por evento; el diálogo lo resuelve ConfirmActionModal. */
   _confirm(config) {
      slice.events.emit('confirm:request', config);
   }

   clearPool() {
      const pool = this._state.pool;
      if (!pool.length) return;

      this._confirm({
         title: 'Vaciar la biblioteca',
         message: `Se eliminan las ${pool.length} imágenes y se vacían todas las hojas. No se puede deshacer.`,
         confirmLabel: 'Vaciar todo',
         danger: true,
         onConfirm: () => this._doClearPool()
      });
   }

   _doClearPool() {
      this._ctx.set((prev) => {
         this._poolSvc.disposeAll(prev.pool);
         return {
            ...prev,
            pool: [],
            sheets: prev.sheets.map((sh) => ({ ...sh, placement: {} }))
         };
      });
      this._pendingRefId = null;
      this._storage?.clearAssets();
      this._toasts?.show('Biblioteca vaciada', { type: 'info' });
   }

   clearPlacements() {
      const used = this._placeSvc.countUsedInSheet(this._sheet());
      if (!used) {
         this._toasts?.show('La hoja ya está vacía', { type: 'info' });
         return;
      }

      this._confirm({
         title: 'Limpiar la hoja',
         message: `Se vacían las ${used} celdas ocupadas. Las imágenes siguen en la biblioteca.`,
         confirmLabel: 'Limpiar',
         danger: true,
         onConfirm: () => {
            this._pushHistory();
            this._commitSheet((s) => this._placeSvc.clearPlacements(s));
            this._toasts?.show('Celdas vaciadas · las imágenes siguen en la biblioteca', { type: 'info' });
         }
      });
   }

   removePlacement(slot) {
      this._pushHistory();
      this._commitSheet((s) => this._placeSvc.removePlacement(s, slot));
   }

   // ---------- colocación gradual ----------

   async _fillFree(assets) {
      const sheet = this._sheet();
      const cellRatio = this._cellRatio(sheet);
      const requested = this._expandByQuantity(assets);

      // fillGradually espera los ASSETS, no sus ids: antes se le pasaba el
      // array de assets y se lo re-mapeaba como ids, así que la cola salía
      // siempre vacía y el auto-acomodo al subir imágenes no hacía nada.
      const queue = this._placeSvc.fillGradually(
         requested, sheet, this._capacity(), cellRatio
      );
      await this._replay(queue);

      const out = requested.length - queue.length;
         if (out > 0) this._toasts?.show(`${out} imagen(es) esperan en la biblioteca`, { type: 'info' });
   }

   _cellRatio(sheet) {
      return this._cellGeometry(
         sheet,
         this._templates.get(sheet.templateId),
         this._templates.page(sheet.pageId),
         this._templates.preset(sheet.presetId)
      ).cellRatio;
   }

   /** Encola una animación de colocación. Las llamadas se serializan. */
   _replay(queue) {
      if (!queue?.length) return this._placeChain;

      this._placeChain = this._placeChain
         .then(async () => {
            this._placing = true;
            for (const step of queue) {
               this._lastAnimatedSlot = step.slot;
               this._commitSheet((s) =>
                  this._placeSvc.placeInSlot(s, step.slot, step.refId, step.fit));
               await new Promise((r) => setTimeout(r, STEP_MS));
            }
         })
         .catch((err) => {
            slice.logger?.logError?.('LayoutsSection', 'Placement failed', err);
         })
         .finally(() => {
            this._lastAnimatedSlot = -1;
            this._placing = false;
         });

      return this._placeChain;
   }

   /**
    * Expande el pool según la cantidad pedida por imagen: una imagen con ×12
    * entra doce veces en la cola de colocación. Es el caso "doce stickers
    * iguales en una hoja".
    */
   _expandByQuantity(pool) {
      const out = [];
      for (const asset of pool) {
         const copies = Math.max(1, Math.round(asset.quantity ?? 1));
         for (let i = 0; i < copies; i++) out.push(asset);
      }
      return out;
   }

   async smartAssign(notify = false) {
      if (this._placing) return;

      const sheet = this._sheet();
      if (!this._state.pool.length) {
         this._toasts?.show('No hay imágenes en la biblioteca todavía', { type: 'info' });
         return;
      }

      const requested = this._expandByQuantity(this._state.pool);
      const cellRatio = this._cellRatio(sheet);
      const queue = this._placeSvc.smartAssign(
         requested, sheet, this._capacity(), cellRatio
      );

      this._commitSheet((s) => this._placeSvc.clearPlacements(s));
      await this._replay(queue);

      if (notify) {
         const out = this._state.pool.length - queue.length;
         this._toasts?.show(out > 0
            ? `${queue.length} colocadas · ${out} sin lugar en la hoja`
            : `${queue.length} imágenes acomodadas`, { type: 'info' });
      }
   }

   /**
    * Fija el tamaño de celda a las medidas reales de un producto y calcula
    * cuántas piezas entran. A diferencia de una plantilla, la celda NO se
    * estira para llenar la hoja: un sticker de 5×5 sale de 5×5 y lo que sobra
    * queda como margen.
    */
   _setProduct(product) {
      const sheet = this._sheet();
      const grid = this._templates.gridForProduct(product, sheet.pageId, sheet.presetId);

      if (!grid.fits) {
         this._toasts?.show(
            `${product.name} no entra en esta hoja con estos márgenes`,
            { type: 'warning' }
         );
         return;
      }

      const tpl = this._templates.ensureGrid(grid.cols, grid.rows);

      this._commitSheet((s) => {
         const cleaned = this._placeSvc.cleanupPlacement(s, grid.total);
         return {
            ...cleaned,
            templateId: tpl.id,
            productId: product.id,
            cellSizeMm: { w: product.wMm, h: product.hMm },
            cols: Array(grid.cols).fill(1),
            rows: Array(grid.rows).fill(1)
         };
      });

      this._toasts?.show(
         `${product.name}: entran ${grid.total} por hoja (${grid.cols}×${grid.rows})`,
         { type: 'success' }
      );
   }

   _setTemplate(t) {
      this._commitSheet((s) => {
         const cleaned = this._placeSvc.cleanupPlacement(s, t.cols * t.rows);
         return {
            ...cleaned,
            templateId: t.id,
            // Elegir una plantilla libera el tamaño fijo: las celdas vuelven a
            // estirarse para llenar la hoja.
            productId: null,
            cellSizeMm: null,
            cols: Array(t.cols).fill(1),
            rows: Array(t.rows).fill(1)
         };
      });

      const waiting = this._state.pool.length - this._placeSvc.countUsedInSheet(this._sheet());
      if (waiting > 0) {
         this._toasts?.show(`${waiting} imagen(es) permanecen en la biblioteca`, { type: 'info' });
      }
   }

   _setImageScale(val) {
      // El slider dispara en cada `input`. Repintamos las celdas en el acto y
      // dejamos que el commit al contexto haga el resto sin reconstruirlas.
      const scale = Number(val) || 1;
      this.$refs.sheet.querySelectorAll('slice-sheet-cell').forEach((cell) => {
         cell.imageScale = scale;
      });
      this._commitSheet((s) => ({ ...s, imageScale: scale }));
   }

   assignToSlot(slot) {
      if (!this._pendingRefId) return;
      const refId = this._pendingRefId;
      const asset = this._asset(refId);
      if (!asset) {
         this._pendingRefId = null;
         return;
      }

      this._lastAnimatedSlot = slot;
      this._commitSheet((s) =>
         this._placeSvc.placeInSlot(s, slot, refId,
            this._placeSvc.fitFor(asset.ratio, this._cellRatio(s), s.fitMode))
      );
      this._pendingRefId = null;
      this._lastAnimatedSlot = -1;
   }

   // ---------- multi-hoja ----------

   renderSheetsBar() {
      const s = this._state;
      const bar = this.$refs.sheetsBar;
      bar.replaceChildren();

      s.sheets.forEach((sh, i) => {
         const used = this._placeSvc.countUsedInSheet(sh);
         const capacity = this._sheetSvc.getCapacity(sh.templateId);

         const chip = document.createElement('div');
         chip.className = 'layoutssection__sheetchip' + (sh.id === s.activeId ? ' is-active' : '');

         const main = document.createElement('button');
         main.type = 'button';
         main.className = 'layoutssection__sheetchip-main';
         main.addEventListener('click', () => this._ctx.patch({ activeId: sh.id }));

         const label = document.createElement('span');
         label.textContent = `Hoja ${i + 1}`;

         const count = document.createElement('small');
         count.className = 'layoutssection__sheetchip-count';
         count.textContent = `${used}/${capacity}`;

         main.append(label, count);
         chip.appendChild(main);

         if (s.sheets.length > 1) {
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'layoutssection__sheetchip-del';
            del.textContent = '×';
            del.setAttribute('aria-label', `Eliminar Hoja ${i + 1}`);
            del.addEventListener('click', (e) => {
               e.stopPropagation();
               this.removeSheet(sh.id);
            });
            chip.appendChild(del);
         }

         bar.appendChild(chip);
      });

      // Dos acciones bien separadas: crear en blanco vs. copiar la activa.
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'layoutssection__sheetchip-add';
      add.textContent = '+ Nueva hoja';
      add.setAttribute('data-tooltip', 'Hoja vacía con la configuración por defecto');
      add.addEventListener('click', () => this.addSheet());
      bar.appendChild(add);

      const dup = document.createElement('button');
      dup.type = 'button';
      dup.className = 'layoutssection__sheetchip-add layoutssection__sheetchip-dup';
      dup.textContent = '⧉ Duplicar';
      dup.setAttribute('data-tooltip', 'Copia la hoja actual con sus ajustes e imágenes');
      dup.addEventListener('click', () => this.duplicateSheet(s.activeId));
      bar.appendChild(dup);

      this._tips?.scope(bar);
   }

   /**
    * Hoja NUEVA: en blanco, con la configuración por defecto del catálogo.
    * No se le pasa la hoja activa a `createSheet` a propósito — hacerlo heredaba
    * página, plantilla, márgenes, ajuste y escala, y "nueva hoja" terminaba
    * comportándose como un clon. Para copiar una hoja está `duplicateSheet`.
    */
   addSheet() {
      // `set` REEMPLAZA el estado: sin esparcir `prev` acá se perdían el pool
      // de imágenes y el zoom cada vez que se creaba una hoja.
      this._ctx.set((prev) => {
         const fresh = this._sheetSvc.createSheet(prev.sheets.length + 1);
         return { ...prev, activeId: fresh.id, sheets: [...prev.sheets, fresh] };
      });
      this._toasts?.show(`Hoja ${this._state.sheets.length} creada en blanco`, { type: 'success' });
   }

   /** Copia exacta de una hoja: ajustes, medidas de celda e imágenes colocadas. */
   duplicateSheet(id) {
      this._ctx.set((prev) => {
         const index = prev.sheets.findIndex((sh) => sh.id === id);
         if (index < 0) return prev;

         const src = prev.sheets[index];
         const copy = {
            ...src,
            id: `sheet-${prev.sheets.length + 1}-${Date.now()}`,
            placement: { ...src.placement },
            cols: Array.isArray(src.cols) ? [...src.cols] : src.cols,
            rows: Array.isArray(src.rows) ? [...src.rows] : src.rows
         };

         const sheets = [...prev.sheets];
         sheets.splice(index + 1, 0, copy);
         return { ...prev, sheets, activeId: copy.id };
      });
      this._toasts?.show('Hoja duplicada', { type: 'success' });
   }

   removeSheet(id) {
      const s = this._state;
      if (s.sheets.length <= 1) return;

      const index = s.sheets.findIndex((sh) => sh.id === id);
      const sheet = s.sheets[index];
      const used = sheet ? this._placeSvc.countUsedInSheet(sheet) : 0;

      // Una hoja vacía se borra sin preguntar: no hay nada que perder.
      if (!used) return this._doRemoveSheet(id);

      this._confirm({
         title: `Eliminar la hoja ${index + 1}`,
         message: `Tiene ${used} imagen(es) colocadas. Se pierde el armado de esta hoja, pero las imágenes siguen en la biblioteca.`,
         confirmLabel: 'Eliminar',
         danger: true,
         onConfirm: () => this._doRemoveSheet(id)
      });
   }

   _doRemoveSheet(id) {
      this._ctx.set((prev) => {
         if (prev.sheets.length <= 1) return prev;
         return { ...prev, ...this._sheetSvc.removeSheet(prev.sheets, prev.activeId, id) };
      });
   }

   // ---------- render ----------

   renderAll() {
      this.renderSheetsBar();
      this.renderControlStates();
      this.renderGallery();
      return this.renderSheet();
   }

   renderControlStates() {
      const sheet = this._sheet();

      if (this._panel) {
         this._panel.sheet = sheet;
         this._panel.update({ sheet: this._prevSheet });
         this._prevSheet = { ...sheet };
      }

      if (this.$refs.zoomInfo) {
         const pct = Math.round((this._state.zoom ?? ZOOM_DEFAULT) * 100);
         this.$refs.zoomInfo.textContent = `${pct}%`;
      }

      if (this.$refs.hint) {
         this.$refs.hint.hidden = this._state.pool.length > 0;
      }
   }

   renderGallery() {
      const host = this._panel?.getGalleryHost();
      if (!host) return;

      const s = this._state;

      host.hidden = s.pool.length === 0;

      // La cáscara (título + botón vaciar) se arma una sola vez; después solo
      // se refresca el contador. Reconstruirla en cada commit del contexto
      // destruía las tarjetas justo mientras el usuario tocaba sus controles.
      if (!this._$galleryGrid || !host.contains(this._$galleryGrid)) {
         host.replaceChildren();

         const header = document.createElement('div');
         header.className = 'layoutspanel__gallery-head';

         this._$galleryTitle = document.createElement('span');
         this._$galleryTitle.className = 'layoutspanel__label';
         header.appendChild(this._$galleryTitle);

         const clear = document.createElement('button');
         clear.type = 'button';
         clear.className = 'layoutspanel__gallery-clear';
         clear.textContent = 'Vaciar';
         clear.setAttribute('data-tooltip', 'Elimina todas las imágenes de la biblioteca');
         clear.addEventListener('click', () => this.clearPool());
         header.appendChild(clear);

         this._$galleryGrid = document.createElement('div');
         this._$galleryGrid.className = 'layoutspanel__gallery';

         host.append(header, this._$galleryGrid);
      }

      this._$galleryTitle.textContent = `Biblioteca (${s.pool.length})`;

      // Serializado: renderGallery() se dispara en cada commit del contexto sin
      // que nadie la espere, y dos pasadas concurrentes construirían dos veces
      // la PoolCard de un mismo asset.
      this._galleryChain = (this._galleryChain || Promise.resolve())
         .then(() => this._renderPoolCards(this._$galleryGrid, this._state.pool,
            this._placeSvc.usedAssetIds(this._sheet())))
         .catch((err) => {
            slice.logger?.logError?.('LayoutsSection', 'Gallery render failed', err);
         });

      return this._galleryChain;
   }

   /** Reusa las tarjetas por sliceId: construye las nuevas, refresca las que
    *  siguen y destruye las que ya no están. */
   async _renderPoolCards(grid, pool, usedInActive) {
      const alive = new Set();

      for (const asset of pool) {
         const id = `pool-card-${asset.id}`;
         alive.add(id);

         let card = slice.getComponent(id);
         if (card) {
            slice.setComponentProps(card, {
               asset,
               pending: this._pendingRefId === asset.id,
               used: usedInActive.has(asset.id),
               quantity: asset.quantity ?? 1
            });
         } else {
            card = await slice.build('PoolCard', {
               sliceId: id,
               asset,
               pending: this._pendingRefId === asset.id,
               used: usedInActive.has(asset.id),
               quantity: asset.quantity ?? 1,
               onSelect: (assetId) => {
                  this._pendingRefId = this._pendingRefId === assetId ? null : assetId;
                  this.renderGallery();
               },
               onRemove: (assetId) => this.removeFromPool(assetId),
                onQuantityChange: (assetId, qty) => this.setAssetQuantity(assetId, qty),
                onContextMenu: (info) => this._showPoolContextMenu(info)
            });
            if (!card) continue;
            this._dndAttach(card, {
               draggable: {
                  handle: card.dragHandle,
                  data: { type: 'pool-asset', assetId: asset.id },
                  ghost: true,
                  ghostClass: 'poolcard--dragging'
               }
            });
         }
         grid.appendChild(card);
      }

      for (const el of Array.from(grid.children)) {
         const id = el.getAttribute?.('slice-id');
         if (!id || alive.has(id)) continue;
         this._dndRelease(el);
         slice.controller.destroyComponent(id);
         el.remove();
      }

      this._releaseDetachedDnd();
   }

   /** Cuántas copias de esta imagen deben entrar en la hoja al auto-acomodar. */
   setAssetQuantity(id, quantity) {
      this._ctx.set((prev) => ({
         ...prev,
         pool: prev.pool.map((a) => (a.id === id ? { ...a, quantity } : a))
      }));
      this._storage?.updateAssetQuantity(id, quantity);
   }

   /** Guarda el crop (zoom/pan) de una celda en la hoja (per-placement). */
   _setPlacementCrop(slotIdx, { cropX, cropY, cropScale }) {
      this._commitSheet((s) => {
         const placement = { ...s.placement };
         if (placement[slotIdx]) {
            placement[slotIdx] = { ...placement[slotIdx], cropX, cropY, cropScale };
         }
         return { ...s, placement };
      });
   }

   /** Selecciona una celda (para zoom/pan). Click en otra celda o fondo deselecciona. */
   _onCellSelect(slotIdx) {
      if (this._selectedSlot === slotIdx) {
         this._selectedSlot = null;
      } else {
         this._selectedSlot = slotIdx;
      }
      this._refreshCellSelection();
   }

   _deselectAll() {
      if (this._selectedSlot === null) return;
      this._selectedSlot = null;
      this._refreshCellSelection();
   }

   _refreshCellSelection() {
      const cells = this.$refs.sheet?.querySelectorAll('slice-sheet-cell') || [];
      for (const cell of cells) {
         const slot = Number(cell.dataset?.slot ?? cell.querySelector('.sheetcell')?.dataset?.slot);
         if (Number.isFinite(slot)) {
            cell.selected = slot === this._selectedSlot;
         }
      }
   }

   renderSheet() {
      const seq = ++this._renderSeq;
      this._renderChain = this._renderChain
         .then(() => {
            if (seq !== this._renderSeq) return null;
            return this._renderSheetInto(this._sheet(), this.$refs.sheet, { interactive: true, seq });
         })
         // Sin este catch, un solo render fallido dejaba la cadena rechazada y
         // ningún render posterior volvía a ejecutarse.
         .catch((err) => {
            slice.logger?.logError?.('LayoutsSection', 'Sheet render failed', err);
         });
      return this._renderChain;
   }

   async _renderSheetInto(sheet, host, { interactive = false, seq = null } = {}) {
      const tpl = this._templates.get(sheet.templateId);
      const page = this._templates.page(sheet.pageId);
      const preset = this._templates.preset(sheet.presetId);
      const geo = this._cellGeometry(sheet, tpl, page, preset);
      const placement = sheet.placement || {};

      // Sin redondear: el contenedor se redondeaba a px enteros mientras los
      // tracks de la grilla iban con decimales, así que la suma de celdas +
      // gaps + márgenes no daba exactamente el alto/ancho de la hoja y esa
      // diferencia se arrastraba hasta el PDF.
      const W = page.w * PX_PER_MM;
      const H = page.h * PX_PER_MM;

      const layout = {
         width: `${W}px`,
         height: `${H}px`,
         padding: `${preset.marginMm * PX_PER_MM}px`,
         gap: `${preset.gapMm * PX_PER_MM}px`,
         gridTemplateColumns: geo.colWmm.map((w) => `${w * PX_PER_MM}px`).join(' '),
         gridTemplateRows: geo.rowHmm.map((h) => `${h * PX_PER_MM}px`).join(' '),
         // Con celdas de tamaño fijo la grilla no llena la hoja: se centra y lo
         // que sobra queda como margen.
         justifyContent: geo.fixed ? 'center' : 'stretch',
         alignContent: geo.fixed ? 'center' : 'stretch'
      };

      if (interactive) {
         Object.assign(host.style, layout, {
            transform: `scale(${this._state.zoom ?? ZOOM_DEFAULT})`,
            transformOrigin: 'top center'
         });
      } else {
         // Rama de exportación: el contenedor vive fuera de <slice-layouts-section>,
         // así que NINGUNA regla del CSS del componente lo alcanza. Todo lo que
         // el layout necesita va inline o la hoja se exporta como una pila
         // vertical de celdas sin grilla.
         Object.assign(host.style, layout, {
            display: 'grid',
            boxSizing: 'border-box',
            position: 'relative',
            background: '#ffffff',
            borderRadius: '0',
            boxShadow: 'none',
            transform: 'none',
            overflow: 'hidden'
         });

         host.replaceChildren();
         for (let idx = 0; idx < tpl.cols * tpl.rows; idx++) {
            host.appendChild(this._buildFlatCell(placement[idx], sheet));
         }
         return;
      }

      const capacity = tpl.cols * tpl.rows;
      const alive = new Set();

      for (let idx = 0; idx < capacity; idx++) {
         const ref = placement[idx];
         const asset = ref ? this._asset(ref.refId) : null;
         const img = asset ? {
            ...asset,
            fit: ref?.fit || 'cover',
            cropX: ref?.cropX ?? 0.5,
            cropY: ref?.cropY ?? 0.5,
            cropScale: ref?.cropScale ?? 1
         } : null;
         const id = cellId(idx);
         alive.add(id);

         let cell = slice.getComponent(id);

          if (cell) {
             // Reuso en sitio: los setters repintan y no se pierde el estado
             // interno ni se re-registra el drag & drop desde cero.
             cell.animate = idx === this._lastAnimatedSlot;
             slice.setComponentProps(cell, {
                slot: idx,
                col: idx % tpl.cols,
                row: Math.floor(idx / tpl.cols),
                img,
                imageScale: sheet.imageScale ?? 1,
                selected: this._selectedSlot === idx
             });
          } else {
             cell = await slice.build('SheetCell', {
                sliceId: id,
                slot: idx,
                col: idx % tpl.cols,
                row: Math.floor(idx / tpl.cols),
                img,
                imageScale: sheet.imageScale ?? 1,
                selected: this._selectedSlot === idx,
                animate: idx === this._lastAnimatedSlot,
                onPick: (slotIdx) => this._onEmptyCellClick(slotIdx),
                onRemove: (slotIdx) => this.removePlacement(slotIdx),
                onMenu: (info) => this._showInfoMenu(info.nativeEvent, info),
                onSelect: (slotIdx) => this._onCellSelect(slotIdx),
                onCropChange: (slotIdx, crop) => this._setPlacementCrop(slotIdx, crop)
             });
          }

         if (seq !== null && seq !== this._renderSeq) return;
         if (!cell) continue;

         host.appendChild(cell);
         this._attachCellDnd(cell, idx, ref);
      }

      // Poda: celdas que sobran tras cambiar a una plantilla más chica.
      for (const el of Array.from(host.children)) {
         const id = el.getAttribute?.('slice-id');
         if (!id || alive.has(id)) continue;
         this._dndRelease(el);
         slice.controller.destroyComponent(id);
         el.remove();
      }

      this._renderSplitters(host, geo, tpl, preset);
      this._releaseDetachedDnd();
      this._tips?.scope(host);
      this._applyCellTooltips(host, geo);
   }

   /** Celda plana para exportación: sin componentes ni CSS externo. */
   _buildFlatCell(ref, sheet) {
      const cell = document.createElement('div');
      Object.assign(cell.style, {
         position: 'relative',
         minWidth: '0',
         minHeight: '0',
         borderRadius: '0',
         overflow: 'hidden'
      });

      const asset = ref ? this._asset(ref.refId) : null;
      if (!asset) return cell;

      const imgScale = sheet.imageScale ?? 1;
      Object.assign(cell.style, {
         backgroundImage: `url("${asset.url}")`,
         backgroundPosition: 'center',
         backgroundRepeat: 'no-repeat',
         backgroundSize: imgScale < 1
            ? `${imgScale * 100}%`
            : (ref.fit === 'contain' ? 'contain' : 'cover')
      });

      return cell;
   }

   // ---------- drag & drop ----------

   _dndAttach(node, { draggable = null, droppable = null } = {}) {
      this._dnd.detach(node);
      if (draggable) this._dnd.makeDraggable(node, draggable);
      if (droppable) this._dnd.makeDroppable(node, droppable);
      this._dndNodes.add(node);
   }

   _dndRelease(node) {
      this._dnd.detach(node);
      this._dndNodes.delete(node);
   }

   /** DragDropService retiene los nodos por siempre; le devolvemos los muertos. */
   _releaseDetachedDnd() {
      for (const node of [...this._dndNodes]) {
         if (!node.isConnected) this._dndRelease(node);
      }
   }

   _attachCellDnd(cell, slotIdx, ref) {
      this._dndAttach(cell, {
         draggable: ref
            ? {
               handle: cell.querySelector('.sheetcell'),
               data: { type: 'cell-swap', sourceSlot: slotIdx, assetId: ref.refId },
               ghost: true,
               threshold: 5
            }
            : null,
         droppable: {
            accept: (data) => data?.type === 'pool-asset' || data?.type === 'cell-swap',
            onDragEnter: () => cell.classList.add('sheetcell--drop-hover'),
            onDragLeave: () => cell.classList.remove('sheetcell--drop-hover'),
            onDrop: (_el, _ev, data) => {
               cell.classList.remove('sheetcell--drop-hover');
               this._handleCellDrop(slotIdx, data);
            }
         }
      });
   }

   _applyCellTooltips(host, geo) {
      if (!this._tips) return;
      const cm = (mm) => `${(mm / 10).toFixed(1)} cm`;
      const cols = geo.colWmm.length;

      Array.from(host.querySelectorAll('slice-sheet-cell')).forEach((cellEl) => {
         const slot = Number(cellEl.querySelector('.sheetcell')?.dataset.slot ?? cellEl.dataset.slot);
         if (!Number.isFinite(slot)) return;
         const col = slot % cols;
         const row = Math.floor(slot / cols);
         const text = `${cm(geo.colWmm[col])} × ${cm(geo.rowHmm[row])}`;
         this._tips.detach(cellEl);
         this._tips.attach(cellEl, { text, placement: 'bottom', showDelay: 120 });
      });
   }

   // ---------- geometría ----------

   _cellGeometry(sheet, tpl, page, preset) {
      return this._geom.geometry(
         tpl, page, preset, sheet.cols, sheet.rows, sheet.cellSizeMm
      );
   }

   // ---------- splitters ----------

   _renderSplitters(host, geo, tpl, preset) {
      host.querySelectorAll('.layoutssection__splitter').forEach((el) => el.remove());

      // Con un producto elegido la celda mide lo que mide: redimensionar por
      // pesos no haría nada, así que tampoco se ofrecen los tiradores.
      if (geo.fixed) return;

      const makeHandle = (axis, k) => {
         const h = document.createElement('div');
         h.className = `layoutssection__splitter layoutssection__splitter--${axis}`;
         h.dataset.axis = axis;
         h.dataset.k = String(k);
         h.addEventListener('pointerdown', (e) => this._beginBoundaryDrag(e, axis, k));
         h.addEventListener('dblclick', () => {
            this._commitSheet((s) => (axis === 'v'
               ? { ...s, cols: Array(tpl.cols).fill(1) }
               : { ...s, rows: Array(tpl.rows).fill(1) }));
         });
         return h;
      };

      for (let k = 1; k < tpl.cols; k++) host.appendChild(makeHandle('v', k));
      for (let k = 1; k < tpl.rows; k++) host.appendChild(makeHandle('h', k));

      this._positionSplitters(host, geo, preset);
   }

   _positionSplitters(host, geo, preset) {
      const inner = preset.marginMm * PX_PER_MM;
      const gapPx = preset.gapMm * PX_PER_MM;
      const innerW = geo.colWmm.reduce((a, b) => a + b, 0) * PX_PER_MM
         + gapPx * (geo.colWmm.length - 1);
      const innerH = geo.rowHmm.reduce((a, b) => a + b, 0) * PX_PER_MM
         + gapPx * (geo.rowHmm.length - 1);

      host.querySelectorAll('.layoutssection__splitter').forEach((h) => {
         const axis = h.dataset.axis;
         const k = Number(h.dataset.k);

         if (axis === 'v') {
            const left = inner
               + geo.colWmm.slice(0, k).reduce((a, b) => a + b, 0) * PX_PER_MM
               + gapPx * k - HOLD_DRAG_PX / 2;
            Object.assign(h.style, {
               left: `${left}px`,
               top: `${inner}px`,
               height: `${innerH}px`,
               width: `${HOLD_DRAG_PX}px`
            });
         } else {
            const top = inner
               + geo.rowHmm.slice(0, k).reduce((a, b) => a + b, 0) * PX_PER_MM
               + gapPx * k - HOLD_DRAG_PX / 2;
            Object.assign(h.style, {
               top: `${top}px`,
               left: `${inner}px`,
               width: `${innerW}px`,
               height: `${HOLD_DRAG_PX}px`
            });
         }
      });
   }

   _beginBoundaryDrag(event, axis, k) {
      event.preventDefault();

      const sheet = this._sheet();
      // Tamaño de producto fijo: los pesos no participan de la geometría.
      if (sheet.cellSizeMm) return;

      const tpl = this._templates.get(sheet.templateId);
      const page = this._templates.page(sheet.pageId);
      const preset = this._templates.preset(sheet.presetId);
      const geo = this._cellGeometry(sheet, tpl, page, preset);

      const host = this.$refs.sheet;
      const startPos = axis === 'v' ? event.clientX : event.clientY;
      const base = axis === 'v' ? [...geo.cols] : [...geo.rows];
      const unit = axis === 'v'
         ? geo.colWmm[k - 1] / base[k - 1]
         : geo.rowHmm[k - 1] / base[k - 1];

      let latest = base;
      let frame = 0;

      const apply = (weights) => {
         const preview = this._geom.geometry(
            tpl, page, preset,
            axis === 'v' ? weights : sheet.cols,
            axis === 'h' ? weights : sheet.rows
         );
         host.style.gridTemplateColumns = preview.colWmm.map((w) => `${w * PX_PER_MM}px`).join(' ');
         host.style.gridTemplateRows = preview.rowHmm.map((h) => `${h * PX_PER_MM}px`).join(' ');
         this._positionSplitters(host, preview, preset);
      };

      const onMove = (ev) => {
         const zoom = this._state.zoom ?? ZOOM_DEFAULT;
         const delta = ((axis === 'v' ? ev.clientX : ev.clientY) - startPos) / (PX_PER_MM * zoom);

         const next = [...base];
         let wA = base[k - 1] + delta / unit;
         let wB = base[k] - delta / unit;
         if (wA < MIN_WEIGHT) { wB += MIN_WEIGHT - wA; wA = MIN_WEIGHT; }
         if (wB < MIN_WEIGHT) { wA += MIN_WEIGHT - wB; wB = MIN_WEIGHT; }
         next[k - 1] = wA;
         next[k] = wB;
         latest = next;

         // Preview puramente visual. Antes se hacía commit al contexto en cada
         // pointermove, y como el watcher dispara renderAll(), cada frame
         // reconstruía TODAS las celdas con slice.build().
         if (!frame) {
            frame = requestAnimationFrame(() => {
               frame = 0;
               apply(latest);
            });
         }
      };

      const onUp = () => {
         window.removeEventListener('pointermove', onMove);
         window.removeEventListener('pointerup', onUp);
         window.removeEventListener('pointercancel', onUp);
         if (frame) cancelAnimationFrame(frame);
         this._commitSheet((s) => (axis === 'v'
            ? { ...s, cols: [...latest] }
            : { ...s, rows: [...latest] }));
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
   }

   // ---------- menú contextual ----------

   _showInfoMenu(e, info) {
      const { img } = info;

      const items = [
         {
            label: 'Editar medidas…',
            icon: 'pen-tool',
            action: () => this._openSizeModal(info)
         }
      ];

      if (img) {
         items.push({ type: 'separator' });
         items.push({
            label: 'Recortar',
            icon: 'scissors',
            action: () => this._openCropModal(info)
         });
         items.push({
            label: 'Editar',
            icon: 'pen-tool',
            action: () => this._openEditModal(info)
         });
         items.push({ type: 'separator' });
         items.push({
            label: 'Rotar 90° izquierda',
            icon: 'rotate-ccw',
            action: () => this._rotateAsset(img.id, -90)
         });
         items.push({
            label: 'Rotar 90° derecha',
            icon: 'rotate-cw',
            action: () => this._rotateAsset(img.id, 90)
         });
         items.push({ type: 'separator' });
         items.push({
            label: 'Voltear horizontal',
            icon: 'flip-horizontal',
            action: () => this._flipAsset(img.id, 'horizontal')
         });
         items.push({
            label: 'Voltear vertical',
            icon: 'flip-vertical',
            action: () => this._flipAsset(img.id, 'vertical')
         });
         items.push({ type: 'separator' });
         items.push({
            label: 'Quitar de la celda',
            icon: 'trash-2',
            danger: true,
            action: () => this.removePlacement(info.slot)
         });
         items.push({
            label: 'Eliminar de la biblioteca',
            icon: 'trash-2',
            danger: true,
            action: () => this.removeFromPool(img.id)
         });
      }

      this._cmenu?.open({ x: e.clientX, y: e.clientY, items });
   }

   _showPoolContextMenu(info) {
      const { nativeEvent: e, asset } = info;
      if (!asset) return;

      const items = [
         {
            label: 'Recortar',
            icon: 'scissors',
            action: () => this._openCropModal({ img: asset })
         },
         {
            label: 'Editar',
            icon: 'pen-tool',
            action: () => this._openEditModal({ img: asset })
         },
         { type: 'separator' },
         {
            label: 'Rotar 90° izquierda',
            icon: 'rotate-ccw',
            action: () => this._rotateAsset(asset.id, -90)
         },
         {
            label: 'Rotar 90° derecha',
            icon: 'rotate-cw',
            action: () => this._rotateAsset(asset.id, 90)
         },
         { type: 'separator' },
         {
            label: 'Voltear horizontal',
            icon: 'flip-horizontal',
            action: () => this._flipAsset(asset.id, 'horizontal')
         },
         {
            label: 'Voltear vertical',
            icon: 'flip-vertical',
            action: () => this._flipAsset(asset.id, 'vertical')
         },
         { type: 'separator' },
         {
            label: 'Eliminar de la biblioteca',
            icon: 'trash-2',
            danger: true,
            action: () => this.removeFromPool(asset.id)
         }
      ];

      this._cmenu?.open({ x: e.clientX, y: e.clientY, items });
   }

   _openSizeModal(info) {
      if (!this._sizeModalPromise) {
         this._sizeModalPromise = (async () => {
            let modal = slice.getComponent('cell-size-modal');
            if (!modal) {
               modal = await slice.build('CellSizeModal', { sliceId: 'cell-size-modal' });
               if (modal) document.body.appendChild(modal);
            }
            return modal;
         })();
      }

      this._sizeModalPromise.then((modal) => {
         if (!modal) return;

         const sheet = this._sheet();
         const tpl = this._templates.get(sheet.templateId);
         const page = this._templates.page(sheet.pageId);
         const preset = this._templates.preset(sheet.presetId);
         const geo = this._cellGeometry(sheet, tpl, page, preset);

         modal.open({
            col: info.col,
            row: info.row,
            img: info.img,
            cellWmm: geo.colWmm[info.col],
            cellHmm: geo.rowHmm[info.row],
            onApply: (wcm, hcm) => {
               this._commitSheet((s) => {
                  const t = this._templates.get(s.templateId);
                  const p = this._templates.page(s.pageId);
                  const pr = this._templates.preset(s.presetId);
                  const g = this._cellGeometry(s, t, p, pr);
                  const next = { ...s };

                  if (!Number.isNaN(wcm)) {
                     next.cols = this._geom.applyTargetSize(
                        g.cols, g.colWmm, info.col, wcm * 10, g.innerW
                     );
                  }
                  if (!Number.isNaN(hcm)) {
                     next.rows = this._geom.applyTargetSize(
                        g.rows, g.rowHmm, info.row, hcm * 10, g.innerH
                     );
                  }
                  return next;
               });
               this._toasts?.show('Medidas de celda aplicadas', { type: 'success', duration: 1600 });
            }
         });
      });
   }

   _openCropModal(info) {
      if (!this._cropModalPromise) {
         this._cropModalPromise = (async () => {
            let modal = slice.getComponent('image-crop-modal');
            if (!modal) {
               modal = await slice.build('ImageCropModal', { sliceId: 'image-crop-modal' });
               if (modal) document.body.appendChild(modal);
            }
            return modal;
         })();
      }

      this._cropModalPromise.then((modal) => {
         if (!modal) return;
         modal.open({
            img: info.img,
            onApply: (blob, dims) => this._replaceAssetBlob(info.img.id, blob, dims)
         });
      });
   }

   _openEditModal(info) {
      if (!this._editModalPromise) {
         this._editModalPromise = (async () => {
            let modal = slice.getComponent('image-edit-modal');
            if (!modal) {
               modal = await slice.build('ImageEditModal', { sliceId: 'image-edit-modal' });
               if (modal) document.body.appendChild(modal);
            }
            return modal;
         })();
      }

      this._editModalPromise.then((modal) => {
         if (!modal) return;
         modal.open({
            img: info.img,
            onApply: (blob, dims) => this._replaceAssetBlob(info.img.id, blob, dims)
         });
      });
   }

   /**
    * Reemplaza el blob de un asset (por crop o edición) actualizando la pool,
    * el almacenamiento y el object URL. Las celdas que referencian este asset
    * se repintan automáticamente porque el contexto dispara renderAll().
    */
   async _replaceAssetBlob(assetId, blob, { pxW, pxH }) {
      if (!blob || !assetId) return;

      const asset = this._asset(assetId);
      if (!asset) return;

      // Revocar la URL anterior si es blob
      if (asset.url?.startsWith('blob:')) {
         URL.revokeObjectURL(asset.url);
      }

      const newUrl = URL.createObjectURL(blob);

      // Actualizar el asset en la pool
      this._ctx.set((prev) => ({
         ...prev,
         pool: prev.pool.map((a) => {
            if (a.id !== assetId) return a;
            return { ...a, url: newUrl, pxW, pxH, ratio: pxW / pxH };
         })
      }));

      // Persistir el nuevo blob en IndexedDB
      await this._storage?.saveAsset({ ...asset, pxW, pxH }, blob);

      this._toasts?.show('Imagen actualizada', { type: 'success', duration: 1600 });
   }

   /**
    * Rota un asset por grados (90, -90, 180, etc.) usando canvas.
    */
   async _rotateAsset(assetId, degrees) {
      this._pushHistory();
      const asset = this._asset(assetId);
      if (!asset?.url) return;

      const imgEl = await new Promise((resolve) => {
         const img = new Image();
         img.crossOrigin = 'anonymous';
         img.onload = () => resolve(img);
         img.onerror = () => resolve(null);
         img.src = asset.url;
      });
      if (!imgEl) return;

      const rad = (degrees * Math.PI) / 180;
      const absD = Math.abs(degrees);
      const swap = absD === 90 || absD === 270;
      const outW = swap ? imgEl.naturalHeight : imgEl.naturalWidth;
      const outH = swap ? imgEl.naturalWidth : imgEl.naturalHeight;

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(outW / 2, outH / 2);
      ctx.rotate(rad);
      ctx.drawImage(imgEl, -imgEl.naturalWidth / 2, -imgEl.naturalHeight / 2);

      const blob = await new Promise((resolve) => {
         canvas.toBlob(resolve, 'image/png', 1);
      });

      this._replaceAssetBlob(assetId, blob, { pxW: canvas.width, pxH: canvas.height });
      this._toasts?.show(`Imagen rotada ${degrees}°`, { type: 'success', duration: 1600 });
   }

   /**
    * Voltea un asset horizontal o verticalmente usando canvas.
    */
   async _flipAsset(assetId, direction) {
      this._pushHistory();
      const asset = this._asset(assetId);
      if (!asset?.url) return;

      const imgEl = await new Promise((resolve) => {
         const img = new Image();
         img.crossOrigin = 'anonymous';
         img.onload = () => resolve(img);
         img.onerror = () => resolve(null);
         img.src = asset.url;
      });
      if (!imgEl) return;

      const canvas = document.createElement('canvas');
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';

      if (direction === 'horizontal') {
         ctx.translate(canvas.width, 0);
         ctx.scale(-1, 1);
      } else {
         ctx.translate(0, canvas.height);
         ctx.scale(1, -1);
      }
      ctx.drawImage(imgEl, 0, 0);

      const blob = await new Promise((resolve) => {
         canvas.toBlob(resolve, 'image/png', 1);
      });

      this._replaceAssetBlob(assetId, blob, { pxW: canvas.width, pxH: canvas.height });
      const label = direction === 'horizontal' ? 'horizontal' : 'vertical';
      this._toasts?.show(`Imagen volteada ${label}`, { type: 'success', duration: 1600 });
   }

   _onEmptyCellClick(slot) {
      if (this._pendingRefId) {
         this.assignToSlot(slot);
         return;
      }
      this.$refs.picker.dataset.slot = String(slot);
      this.$refs.picker.click();
   }

   _handleCellDrop(targetSlot, data) {
      if (!data) return;
      const sheet = this._sheet();

      if (data.type === 'pool-asset') {
         const asset = this._asset(data.assetId);
         if (!asset) return;
         const fit = this._placeSvc.fitFor(asset.ratio, this._cellRatio(sheet), sheet.fitMode);
         this._commitSheet((s) => this._placeSvc.placeInSlot(s, targetSlot, asset.id, fit));
         return;
      }

      if (data.type === 'cell-swap') {
         const sourceSlot = data.sourceSlot;
         if (sourceSlot === targetSlot) return;

         this._commitSheet((s) => {
            const placement = { ...s.placement };
            const sourceRef = placement[sourceSlot];
            const targetRef = placement[targetSlot];
            if (!sourceRef) return s;

            placement[targetSlot] = sourceRef;
            if (targetRef) placement[sourceSlot] = targetRef;
            else delete placement[sourceSlot];

            return { ...s, placement };
         });
      }
   }

   // ---------- exportación ----------

   _setBusy(on, text = '') {
      const busy = this.$refs.busy;
      if (busy) {
         busy.hidden = !on;
         if (this.$refs.busyText) this.$refs.busyText.textContent = text;
      }
      this._panel?.setBusy?.(on);
   }

   /**
    * Renderiza todas las hojas offscreen, corre `fn(stages)` y limpia siempre.
    * Bloquea reentradas: dos clicks seguidos duplicaban toda la exportación.
    * @param {boolean} activeOnly — si es true, solo exporta la hoja activa.
    */
   async _withStages(label, fn, { activeOnly = false } = {}) {
      if (this._exporting) return null;
      if (!this._state.sheets.length) return null;

      const sheets = activeOnly
         ? [this._sheet()]
         : this._state.sheets;

      this._exporting = true;
      this._setBusy(true, `${label}…`);

      let stages = null;
      try {
         stages = await this._exportSvc.renderOffscreen(
            sheets,
            (sheet, node) => this._renderSheetInto(sheet, node, { interactive: false })
         );
         return await fn(stages, (done, total) =>
            this._setBusy(true, `${label} ${Math.min(done + 1, total)}/${total}`));
      } finally {
         this._exportSvc.cleanupStages(stages);
         this._setBusy(false);
         this._exporting = false;
      }
   }

   async exportPNGs({ activeOnly = false } = {}) {
      try {
         const count = await this._withStages('Exportando PNG', (stages, onProgress) =>
            this._exportSvc.exportPNGs(stages, html2canvas, { onProgress }), { activeOnly });
         if (count) this._toasts?.show(`${count} hoja(s) exportadas como PNG`, { type: 'success' });
      } catch (err) {
         slice.logger?.logError?.('LayoutsSection', 'PNG export failed', err);
         this._toasts?.show('Error al exportar PNGs', { type: 'error' });
      }
   }

   /**
    * Traduce el estado a un plan puramente geométrico en milímetros. Es lo que
    * permite que el PDF no dependa de rasterizar la hoja: cada imagen ya viene
    * con su posición y tamaño físicos resueltos.
    * @param {boolean} activeOnly — si es true, solo incluye la hoja activa.
    */
   _buildExportPlan({ activeOnly = false } = {}) {
      const sheets = activeOnly ? [this._sheet()] : this._state.sheets;
      return sheets.map((sheet) => {
         const tpl = this._templates.get(sheet.templateId);
         const page = this._templates.page(sheet.pageId);
         const preset = this._templates.preset(sheet.presetId);
         const geo = this._cellGeometry(sheet, tpl, page, preset);
         const placement = sheet.placement || {};
         const scale = sheet.imageScale ?? 1;

         const items = [];
         for (const cell of this._geom.cellRects(tpl, page, preset, geo)) {
            const ref = placement[cell.slot];
            const asset = ref ? this._asset(ref.refId) : null;
            if (!asset) continue;

            const rect = this._geom.imageRect(cell, asset.ratio, ref.fit || 'cover', scale);
            items.push({
               url: asset.url,
               name: asset.name,
               cellRatio: cell.wMm / cell.hMm,
               ...rect
            });
         }

         return { widthMm: page.w, heightMm: page.h, items };
      });
   }

   async exportPDF({ activeOnly = false } = {}) {
      if (this._exporting) return;
      if (!this._state.sheets.length) return;

      this._exporting = true;
      this._setBusy(true, 'Generando PDF…');

      try {
         const ok = await this._exportSvc.exportPDFExact(
            this._buildExportPlan({ activeOnly }),
            jsPDF,
            {
               onProgress: (done, total) =>
                  this._setBusy(true, `Generando PDF ${Math.min(done + 1, total)}/${total}`)
            }
         );
         if (ok) {
            const msg = activeOnly ? 'PDF de hoja activa generado' : 'PDF generado a tamaño real';
            this._toasts?.show(msg, { type: 'success' });
         }
      } catch (err) {
         slice.logger?.logError?.('LayoutsSection', 'PDF export failed', err);
         this._toasts?.show('Error al generar el PDF', { type: 'error' });
      } finally {
         this._setBusy(false);
         this._exporting = false;
      }
   }


   async printSheets({ activeOnly = false } = {}) {
      const sheets = activeOnly ? [this._sheet()] : this._state.sheets;
      const pages = new Set(sheets.map((s) => s.pageId));
      if (pages.size > 1) {
         this._toasts?.show(
            'Las hojas tienen tamaños distintos: se imprimirán con el tamaño de la primera',
            { type: 'warning' }
         );
      }

      try {
         const ok = await this._withStages('Preparando impresión', async (stages) => {
            // Se imprime desde los nodos offscreen (planos y medidos en mm
            // reales). Clonar la hoja de pantalla arrastraba el transform de
            // zoom y salía impresa al 70%.
            const started = this._exportSvc.printSheets(stages);
            // Un respiro para que el iframe termine de disponer el layout antes
            // de que _withStages descarte los nodos originales.
            await new Promise((r) => setTimeout(r, 300));
            return started;
         }, { activeOnly });
         if (!ok) this._toasts?.show('No se pudo abrir el diálogo de impresión', { type: 'error' });
      } catch (err) {
         slice.logger?.logError?.('LayoutsSection', 'Print failed', err);
         this._toasts?.show('Error al preparar la impresión', { type: 'error' });
      }
   }
}

customElements.define('slice-layouts-section', LayoutsSection);
