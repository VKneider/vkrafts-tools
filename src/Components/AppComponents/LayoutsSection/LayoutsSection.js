import html2canvas from 'html2canvas';
import heic2any from 'heic2any';

// jsPDF se carga en tiempo de ejecución desde `src/public/vendor/`.
//
// No se importa con `import { jsPDF } from 'jspdf'` porque el empaquetador de
// Slice (4.2/4.5) indenta las líneas del código minificado de las dependencias
// externas, y eso mete 4 espacios dentro de los literales de plantilla de
// jsPDF. Resultado: TODOS los streams del PDF (contenido e imágenes) quedan
// corridos 4 bytes y el archivo sale con las hojas en blanco.
//
// Se usa el build **UMD** (autocontenido) y no el ESM: el ESM de jsPDF importa
// `@babel/runtime` y `fflate` por nombre, que solo resuelve el empaquetador.
// Servido como asset estático, el archivo no pasa por ese paso.
let _jsPDFPromise = null;

function cargarJsPDF() {
   if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);

   if (!_jsPDFPromise) {
      _jsPDFPromise = new Promise((resolve, reject) => {
         const script = document.createElement('script');
         script.src = '/vendor/jspdf.umd.min.js';
         script.async = true;
         script.onload = () => {
            if (window.jspdf?.jsPDF) resolve(window.jspdf.jsPDF);
            else reject(new Error('jsPDF no se registró'));
         };
         script.onerror = () => reject(new Error('No se pudo cargar jsPDF'));
         document.head.appendChild(script);
      }).catch((err) => {
         _jsPDFPromise = null;
         throw err;
      });
   }

   return _jsPDFPromise;
}

// 1 mm real en píxeles CSS a 96dpi. El valor exacto importa: con la constante
// anterior (3.4) la hoja se renderizaba al ~90% y todo lo impreso/exportado
// salía más chico que el tamaño de papel declarado.
const PX_PER_MM = 96 / 25.4;

const STEP_MS = 140;
const HOLD_DRAG_PX = 10;
const MIN_WEIGHT = 0.15;
// Espejo de SheetGeometry.MIN_CELL_MM: al arrastrar un límite en modo de
// medidas exactas ninguna de las dos celdas puede quedar por debajo.
const MIN_CELL_MM = 15;
const MAX_FILES = 30;
// La biblioteca se pagina de a tandas para no empujar los controles de la hoja
// fuera de la vista. 12 miniaturas son ~3 filas en el panel lateral.
const POOL_PAGE_SIZE = 12;
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

      // Estado de guardado: el SheetStorage emite `sheet:save` en cada
      // debounce/flush. El bind limpia la suscripción al destruir la sección.
      this._events = slice.events.bind(this);
      this._events.subscribe('sheet:save', (payload = {}) => this._setSaveStatus(payload));
      this._saveStatusTimer = 0;
      this._saveErrorShown = false;
      this._saveWarningShown = false;

      this._cmenu = slice.getComponent('app-context-menu');
      if (!this._cmenu) {
         this._cmenu = await slice.build('ContextMenu', { sliceId: 'app-context-menu' });
         if (this._cmenu) document.body.appendChild(this._cmenu);
      }

      this._pendingRefId = null;
      this._placing = false;
      this._exporting = false;
      // Página actual de la biblioteca (1-based). Se recorta en cada render
      // cuando el pool cambia de tamaño.
      this._poolPage = 1;
      // Filtro de la biblioteca (component-local; no se persiste).
      this._poolQuery = '';
      this._renderSeq = 0;
      this._renderChain = Promise.resolve();
      this._placeChain = Promise.resolve();
      this._lastAnimatedSlot = -1;
      this._dndNodes = new Set();
      this._lastRendered = null;

      // Historial para undo/redo: cada snapshot es una copia profunda del estado.
      this._history = [];
      this._future = [];
      this._historyMax = 50;

      // Clipboard para copiar/pegar placements
      this._clipboard = null;

      // El crop ahora vive en el asset (se comparte entre copias). El guardado
      // en IndexedDB se debouncea: arrastrar dispara decenas de cambios.
      this._cropTimers = new Map();
      this._pendingCrops = new Map();

      // Selección de celdas para zoom/pan y acciones en lote.
      this._selectedSlots = new Set();
      this._selectionAnchor = null;
      this._navigatingGrid = false;

      // Restaurar ANTES de construir los controles: el panel se inicializa
      // leyendo la hoja activa, así que tiene que ver ya el estado recuperado.
      await this._restoreSession();

      await this._buildControls();

      // Bind the watcher AFTER _restoreSession + _buildControls so the initial
      // context.set() inside _restoreSession doesn't trigger renderAll() while
      // _panel is still null (which would skip gallery rendering).
      this._watchHandle = this._ctx.watch(this, (state) => this._onContextChange(state));
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

      // Los fades del rail de hojas dependen del ancho disponible.
      window.addEventListener('resize', this._onResize = () => this._updateSheetRailFades());
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

      // Migración: las sesiones viejas guardaban el crop por placement. Ahora
      // vive en el asset (una misma imagen comparte zoom/encuadre en todas sus
      // copias y hojas). Se adopta el primer crop encontrado por asset.
      const legacyCrops = new Map();
      for (const sheet of restored.sheets) {
         for (const ref of Object.values(sheet.placement || {})) {
            if (!ref?.refId || legacyCrops.has(ref.refId)) continue;
            if (ref.cropScale === undefined && ref.cropX === undefined && ref.cropY === undefined) {
               continue;
            }
            legacyCrops.set(ref.refId, {
               cropScale: ref.cropScale ?? 1,
               cropX: ref.cropX ?? 0.5,
               cropY: ref.cropY ?? 0.5
            });
         }
      }
      if (legacyCrops.size) {
         restored.pool = restored.pool.map((asset) => {
            if (asset.cropScale !== undefined || !legacyCrops.has(asset.id)) return asset;
            return { ...asset, ...legacyCrops.get(asset.id) };
         });
         for (const [assetId, crop] of legacyCrops) {
            this._storage?.updateAssetCrop?.(assetId, crop);
         }
      }

      // El papel es global: si una sesión vieja tenía hojas con tamaños
      // distintos (o un tamaño personalizado ya retirado), se unifican al de la
      // hoja activa o a A4, limpiando las medidas exactas de las que cambian.
      const activeSheet = restored.sheets.find((s) => s.id === restored.activeId)
         || restored.sheets[0];
      const validPageIds = new Set(this._templates.pages().map((p) => p.id));
      const targetPage = validPageIds.has(activeSheet?.pageId)
         ? activeSheet.pageId
         : 'a4';
      const mixed = restored.sheets.some((s) => s.pageId !== targetPage);
      const sheets = mixed
         ? this._sheetSvc.setPageForAll(restored.sheets, targetPage)
         : restored.sheets;

      this._ctx.set((prev) => ({
         ...prev,
         activeId: restored.activeId,
         sheets,
         pool: restored.pool,
         zoom: restored.zoom ?? prev.zoom
      }));

      if (mixed) {
         this._toasts?.show(
            `Se unificó el tamaño de hoja a ${this._templates.page(targetPage).label}`,
            { type: 'info', duration: 3200 }
         );
      }

      if (restored.pool.length) {
         this._toasts?.show(
            `Sesión restaurada · ${restored.pool.length} imagen(es) y ${restored.sheets.length} hoja(s)`,
            { type: 'info', duration: 3000 }
         );
      }
   }

   /** Pinta el estado de guardado que emite SheetStorage. */
   _setSaveStatus({ status, message } = {}) {
      const el = this.$refs.saveState;
      if (!el) return;

      clearTimeout(this._saveStatusTimer);
      this._saveStatusTimer = 0;
      el.classList.remove('is-saving', 'is-saved', 'is-error', 'is-warning');
      el.removeAttribute('title');

      if (status === 'saving') {
         el.textContent = 'Guardando…';
         el.classList.add('is-saving');
         return;
      }

      if (status === 'saved') {
         this._saveErrorShown = false;
         // El aviso de cuota es persistente: no lo pisa el "Guardado" normal.
         if (this._saveWarningShown) {
            el.textContent = 'Poco espacio';
            el.classList.add('is-warning');
            return;
         }
         el.textContent = 'Guardado';
         el.classList.add('is-saved');
         this._saveStatusTimer = setTimeout(() => {
            el.textContent = '';
            el.classList.remove('is-saved');
            this._saveStatusTimer = 0;
         }, 1600);
         return;
      }

      if (status === 'error') {
         el.textContent = 'Error al guardar';
         el.classList.add('is-error');
         el.title = message || 'No se pudo guardar la planilla';
         if (!this._saveErrorShown) {
            this._saveErrorShown = true;
            this._toasts?.show(message || 'No se pudo guardar la planilla', {
               type: 'error',
               duration: 5000
            });
         }
         return;
      }

      if (status === 'warning') {
         el.textContent = 'Poco espacio';
         el.classList.add('is-warning');
         el.title = message || 'Queda poco espacio para imágenes';
         if (!this._saveWarningShown) {
            this._saveWarningShown = true;
            this._toasts?.show(message || 'Queda poco espacio para imágenes', {
               type: 'warning',
               duration: 6000
            });
         }
      }
   }

   beforeDestroy() {
      // El guardado va con debounce: sin este flush se pierde el último cambio
      // si el usuario navega enseguida.
      this._storage?.flush();
      clearTimeout(this._saveStatusTimer);
      for (const timer of this._cropTimers.values()) clearTimeout(timer);
      this._cropTimers.clear();
      // No perder el último encuadre si se navega antes del debounce.
      for (const [assetId, crop] of this._pendingCrops) {
         this._storage?.updateAssetCrop?.(assetId, crop);
      }
      this._pendingCrops.clear();

      document.removeEventListener('paste', this._onPaste);
      document.removeEventListener('wheel', this._onWheel);
      document.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('resize', this._onResize);
      this._sheetRailObserver?.disconnect();
      this._sheetRailObserver = null;

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
         { key: 'auto', label: 'Auto acomodar', icon: 'star', variant: 'filled', tip: 'Reparte todas las imágenes en la hoja actual y, si no entran, en hojas nuevas con la misma configuración', handler: () => this.smartAssign(true) },
         { key: 'clear', label: 'Limpiar hoja', icon: 'minus', variant: 'outlined', tip: 'Quita las imágenes de la hoja (quedan en la biblioteca)', handler: () => this.clearPlacements() },
         { key: 'pngs', label: 'PNGs', icon: 'image', variant: 'outlined', tip: 'Descarga como imágenes (para uso digital)', handler: () => this.exportPNGs() },
         { key: 'pdf', label: 'PDF', icon: 'download', variant: 'outlined', tip: 'Descarga con medidas exactas (recomendado para imprimir)', handler: () => this.exportPDF() },
         { key: 'print', label: 'Imprimir', icon: 'printer', variant: 'soft', tip: 'Imprimir todas las hojas a tamaño real', handler: () => this.printSheets() },
         { key: 'export', label: 'Exportar…', icon: 'layers', variant: 'outlined', tip: 'Elegir qué hojas y en qué formato exportar', handler: () => this._openExportModal() }
      ];

      this._panel = await slice.build('LayoutsPanel', {
         sheet,
         templates: this._templates,
         onFiles: (files) => this.addFiles(files),
         actions: actionDefs,
         // El papel es global: todas las hojas comparten la misma medida para
         // que el PDF y la impresión salgan homogéneos.
         onPageChange: (pageId) => {
            if (pageId === this._sheet().pageId) return;
            this._pushHistory();
            this._commitAll((prev) => ({
               ...prev,
               sheets: this._sheetSvc.setPageForAll(prev.sheets, pageId)
            }));
            const page = this._templates.page(pageId);
            this._toasts?.show(
               `Tamaño ${page.label} aplicado a todas las hojas`,
               { type: 'success', duration: 2000 }
            );
         },
         onTemplateChange: (t) => this._setTemplate(t),
         onCustomGrid: (cols, rows) => this._setCustomGrid(cols, rows),
         onPresetChange: (presetId) => {
            if (presetId === this._sheet().presetId) return;
            this._pushHistory();
            this._commitSheet((s) => ({ ...s, presetId }));
         },
         onCustomPreset: (preset) => this._setCustomPreset(preset),
         onFitChange: (fitMode) => {
            if (fitMode === this._sheet().fitMode) return;
            this._pushHistory();
            this._commitSheet((s) => ({ ...s, fitMode }));
         },
         onScaleStart: () => this._pushHistory(),
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

      // Navegación por teclado entre celdas (flechas/Home/End).
      this.$refs.sheet.addEventListener('keydown', (e) => this._handleGridKey(e));

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

      // Aplicar el transform ya, sin esperar al contexto. El watcher detecta
      // que solo cambió el zoom y no vuelve a repintar rail/galería/hoja.
      this._applyZoom(next);
      // patch: `set` reemplaza el estado completo y se llevaría pool y hojas.
      this._ctx.patch({ zoom: next });
   }

   /** Solo el transform de la hoja + el indicador. No re-renderiza hijos. */
   _applyZoom(value = this._state.zoom ?? ZOOM_DEFAULT) {
      const sheet = this.$refs.sheet;
      if (sheet) {
         sheet.style.transform = `scale(${value})`;
         sheet.style.transformOrigin = 'top center';
      }
      if (this.$refs.zoomInfo) {
         const pct = Math.round(value * 100);
         this.$refs.zoomInfo.textContent = `${pct}%`;
      }
   }

   /**
    * Watcher único del contexto. Si entre dos estados solo cambió `zoom`,
    * aplica el transform en sitio en vez de reconstruir la vista entera.
    */
   _onContextChange(state = this._state) {
      this._storage?.scheduleSave(state);

      const prev = this._lastRendered;
      const zoomOnly = !!prev
         && prev.sheets === state.sheets
         && prev.pool === state.pool
         && prev.activeId === state.activeId
         && prev.zoom !== state.zoom;

      this._lastRendered = {
         sheets: state.sheets,
         pool: state.pool,
         activeId: state.activeId,
         zoom: state.zoom
      };

      if (zoomOnly) this._applyZoom();
      else this.renderAll();
   }

   // ---------- atajos de teclado ----------

   _handleShortcut(e) {
      const ctrl = e.ctrlKey || e.metaKey;
      // Con Shift, `key` llega en mayúscula ("E"), así que se normaliza para
      // que Ctrl+Shift+E/P (solo hoja activa) y Ctrl+Shift+Z (rehacer) anden.
      const key = String(e.key || '').toLowerCase();

      // Ctrl+Z — Deshacer (restaurar estado anterior del historial)
      if (ctrl && key === 'z' && !e.shiftKey) {
         e.preventDefault();
         this._undo();
         return;
      }

      // Ctrl+Y o Ctrl+Shift+Z — Rehacer
      if ((ctrl && key === 'y' && !e.shiftKey) || (ctrl && e.shiftKey && key === 'z')) {
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

      // Ctrl+A — Seleccionar todas las celdas de la hoja activa
      if (ctrl && key === 'a' && !e.shiftKey) {
         e.preventDefault();
         this._selectAllCells();
         return;
      }

      // Ctrl+C — Copiar placement de la celda activa
      if (ctrl && key === 'c' && !e.shiftKey) {
         e.preventDefault();
         this._copyPlacement();
         return;
      }

      // Ctrl+V — Pegar placement en la celda activa
      if (ctrl && key === 'v' && !e.shiftKey) {
         e.preventDefault();
         this._pastePlacement();
         return;
      }

      // Ctrl+D — Duplicar hoja
      if (ctrl && key === 'd' && !e.shiftKey) {
         e.preventDefault();
         this.duplicateSheet(this._state.activeId);
         return;
      }

      // Ctrl+E — Exportar PDF (Ctrl+Shift+E = solo hoja activa)
      if (ctrl && key === 'e') {
         e.preventDefault();
         this.exportPDF({ activeOnly: e.shiftKey });
         return;
      }

      // Ctrl+P — Imprimir (Ctrl+Shift+P = solo hoja activa)
      if (ctrl && key === 'p') {
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

   /**
    * Quita las imágenes de las celdas seleccionadas. Con una sola celda es el
    * Delete clásico; con varias, borra en lote.
    */
   _removeFromActiveCell() {
      const slots = [...this._selectedSlots]
         .filter((slot) => this._sheet().placement?.[slot]);

      if (!slots.length) {
         this._toasts?.show('Seleccioná una celda para quitarla', {
            type: 'info',
            duration: 1600
         });
         return;
      }

      this._removeSelected();
   }

   _removeSelected() {
      const slots = [...this._selectedSlots]
         .filter((slot) => this._sheet().placement?.[slot]);
      if (!slots.length) return;

      this._pushHistory();
      this._commitSheet((s) => {
         const placement = { ...s.placement };
         for (const slot of slots) delete placement[slot];
         return { ...s, placement };
      });
      this._clearSelection();

      this._toasts?.show(
         `${slots.length} celda(s) vaciada(s)`,
         { type: 'info', duration: 1400 }
      );
   }

   /** Aplica un ajuste (cover/contain) a todas las celdas seleccionadas. */
   _setFitForSelected(fit) {
      const slots = [...this._selectedSlots]
         .filter((slot) => this._sheet().placement?.[slot]);
      if (!slots.length) return;

      this._pushHistory();
      this._commitSheet((s) => {
         const placement = { ...s.placement };
         for (const slot of slots) {
            placement[slot] = { ...placement[slot], fit };
         }
         return { ...s, placement };
      });

      this._toasts?.show(
         `Ajuste ${fit === 'cover' ? 'cubrir' : 'contener'} en ${slots.length} celda(s)`,
         { type: 'success', duration: 1600 }
      );
   }

   /** Copia el placement de la celda activa de la selección. */
   _copyPlacement() {
      const slot = this._primarySelectedSlot();
      const ref = slot !== null ? this._sheet().placement?.[slot] : null;

      if (!ref) {
         this._toasts?.show('Seleccioná una celda para copiar', {
            type: 'info',
            duration: 1600
         });
         return;
      }

      this._clipboard = { ...ref };
      this._toasts?.show('Placement copiado', { type: 'info', duration: 1200 });
   }

   /**
    * Pega el placement copiado: en la celda seleccionada si hay una, en todas
    * las seleccionadas si hay varias, o en el primer hueco como atajo.
    */
   _pastePlacement() {
      if (!this._clipboard) {
         this._toasts?.show('No hay nada pegado', { type: 'info', duration: 1200 });
         return;
      }

      const targets = [...this._selectedSlots];
      if (targets.length > 1) {
         this._pasteIntoSlots(targets);
         return;
      }
      if (targets.length === 1) {
         this._pasteIntoSlot(targets[0]);
         return;
      }

      const sheet = this._sheet();
      const tpl = this._templates.get(sheet.templateId);
      const capacity = tpl.cols * tpl.rows;
      const placement = sheet.placement || {};

      for (let slot = 0; slot < capacity; slot++) {
         if (!placement[slot]) {
            this._pasteIntoSlot(slot);
            return;
         }
      }
      this._toasts?.show('La hoja está llena', { type: 'warning', duration: 1500 });
   }

   /** Pega el clipboard en un slot concreto (reemplaza si ya hay imagen). */
   _pasteIntoSlot(slot) {
      if (!this._clipboard) return;

      const sheet = this._sheet();
      const asset = this._asset(this._clipboard.refId);
      if (!asset) {
         this._clipboard = null;
         this._toasts?.show('La imagen copiada ya no está en la biblioteca', {
            type: 'warning',
            duration: 2000
         });
         return;
      }

      const fit = this._placeSvc.fitFor(asset.ratio, this._cellRatio(sheet), sheet.fitMode);
      // Se conserva el crop/zoom del placement copiado, no solo la referencia.
      const ref = { ...this._clipboard, fit };

      this._pushHistory();
      this._commitSheet((s) => ({
         ...s,
         placement: { ...s.placement, [slot]: ref }
      }));
      this._toasts?.show('Placement pegado', { type: 'info', duration: 1200 });
   }

   _primarySelectedSlot() {
      if (this._selectionAnchor !== null && this._selectedSlots.has(this._selectionAnchor)) {
         return this._selectionAnchor;
      }
      const first = this._selectedSlots.values().next();
      return first.done ? null : first.value;
   }

   /** Pega el mismo placement en varias celdas seleccionadas (un solo undo). */
   _pasteIntoSlots(slots) {
      if (!this._clipboard) return;

      const asset = this._asset(this._clipboard.refId);
      if (!asset) {
         this._clipboard = null;
         this._toasts?.show('La imagen copiada ya no está en la biblioteca', {
            type: 'warning',
            duration: 2000
         });
         return;
      }

      this._pushHistory();
      this._commitSheet((s) => {
         const placement = { ...s.placement };
         const fit = this._placeSvc.fitFor(asset.ratio, this._cellRatio(s), s.fitMode);
         for (const slot of slots) {
            placement[slot] = { ...this._clipboard, fit };
         }
         return { ...s, placement };
      });

      this._toasts?.show(
         `Placement pegado en ${slots.length} celda(s)`,
         { type: 'info', duration: 1400 }
      );
   }

   _clearSelection() {
      this._selectedSlots.clear();
      this._selectionAnchor = null;
      this._refreshCellSelection();
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

      // Las imágenes se agregan al final del pool: saltar a la última página
      // para que las recién agregadas queden a la vista. Un filtro activo se
      // limpia para no esconderlas.
      this._poolQuery = '';
      this._poolPage = Math.max(
         1,
         Math.ceil((this._state.pool.length + assets.length) / POOL_PAGE_SIZE)
      );

      this._ctx.set((prev) => ({ ...prev, pool: [...prev.pool, ...assets] }));

      if (directSlot !== null) {
         const sheet = this._sheet();
         const cellRatio = this._cellRatio(sheet);
         const [first, ...rest] = assets;
         const fit = this._placeSvc.fitFor(first.ratio, cellRatio, sheet.fitMode);
         this._lastAnimatedSlot = directSlot;
         this._commitSheet((s) => this._placeSvc.placeInSlot(s, directSlot, first.id, fit));
         this._lastAnimatedSlot = -1;
         this._toasts?.show('Imagen colocada en la celda', {
            type: 'success',
            duration: 1400
         });
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
         message: `Se eliminan las ${pool.length} imágenes y la planilla vuelve a una sola hoja en blanco (con la configuración actual). No se puede deshacer.`,
         confirmLabel: 'Vaciar todo',
         danger: true,
         onConfirm: () => this._doClearPool()
      });
   }

   _doClearPool() {
      this._poolQuery = '';
      this._poolPage = 1;
      this._pendingRefId = null;
      this._selectedSlots.clear();
      this._selectionAnchor = null;

      this._ctx.set((prev) => {
         this._poolSvc.disposeAll(prev.pool);
         // No alcanza con vaciar placements: la planilla vuelve a una sola
         // hoja en blanco con la configuración de la hoja activa.
         const current = this._sheetSvc.getActiveSheet(prev);
         const fresh = this._sheetSvc.createSheet(1, current);

         return {
            ...prev,
            pool: [],
            sheets: [fresh],
            activeId: fresh.id
         };
      });

      this._storage?.clearAssets();
      this._toasts?.show('Biblioteca vaciada · planilla reiniciada a 1 hoja', {
         type: 'info'
      });
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

   /**
    * Reparte **todas** las copias de la biblioteca, no solo las que entran en la
    * hoja activa. La activa recibe las primeras `capacidad` piezas y, cuando
    * sobran, se crean hojas nuevas a continuación con **la misma configuración**
    * (papel, plantilla, márgenes, producto y pesos de columnas/filas).
    *
    * Antes esto se detenía en la capacidad de una hoja: las imágenes que no
    * entraban quedaban en la biblioteca y el usuario tenía que crear hojas a
    * mano con la configuración por defecto.
    *
    * @param {boolean} notify — muestra el resumen al terminar
    * @returns {Promise<number>} cantidad de hojas nuevas
    */
   async smartAssign(notify = false) {
      if (this._placing) return 0;

      const sheet = this._sheet();
      if (!this._state.pool.length) {
         this._toasts?.show('No hay imágenes en la biblioteca todavía', { type: 'info' });
         return 0;
      }

      const capacity = this._capacity();
      if (!capacity) {
         this._toasts?.show('Esta plantilla no tiene celdas', { type: 'warning' });
         return 0;
      }

      const requested = this._expandByQuantity(this._state.pool);
      const cellRatio = this._cellRatio(sheet);

      // Una sola entrada de historial para todo el acomodo (incluye las hojas
      // nuevas): deshacerlo tiene que devolver la planilla como estaba.
      this._pushHistory();

      // 1) La hoja activa se vacía y se llena con las primeras piezas.
      const first = requested.slice(0, capacity);
      const rest = requested.slice(capacity);
      const queue = this._placeSvc.smartAssign(first, sheet, capacity, cellRatio);
      this._commitSheet((s) => this._placeSvc.clearPlacements(s));
      await this._replay(queue);

      // 2) El resto se reparte en hojas nuevas clonadas de la activa. Cada
      //    bloque se acomoda con el mismo criterio que la primera hoja.
      const nuevas = [];
      for (let i = 0; i < rest.length; i += capacity) {
         const chunk = rest.slice(i, i + capacity);
         const nueva = this._sheetSvc.createSheet(
            this._state.sheets.length + nuevas.length + 1,
            sheet
         );
         const cola = this._placeSvc.smartAssign(chunk, nueva, capacity, cellRatio);
         for (const step of cola) {
            nueva.placement[step.slot] = { refId: step.refId, fit: step.fit };
         }
         nuevas.push(nueva);
      }

      if (nuevas.length) {
         this._ctx.set((prev) => {
            const index = prev.sheets.findIndex((sh) => sh.id === sheet.id);
            const sheets = [...prev.sheets];
            // A continuación de la hoja acomodada, no al final: el orden de la
            // planilla sigue el orden en que se fue armando.
            sheets.splice(index < 0 ? sheets.length : index + 1, 0, ...nuevas);
            return { ...prev, sheets, activeId: sheet.id };
         });
      }

      if (notify) {
         const hojas = 1 + nuevas.length;
         this._toasts?.show(
            `${requested.length} ${requested.length === 1 ? 'imagen' : 'imágenes'} · ` +
            `${hojas} ${hojas === 1 ? 'hoja' : 'hojas'}`,
            { type: 'success' }
         );
      }

      return nuevas.length;
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

      this._pushHistory();
      const tpl = this._templates.ensureGrid(grid.cols, grid.rows);

      this._commitSheet((s) => {
         const cleaned = this._placeSvc.cleanupPlacement(s, grid.total);
         return {
            ...cleaned,
            templateId: tpl.id,
            productId: product.id,
            cellSizeMm: { w: product.wMm, h: product.hMm },
            // El producto fija ambos ejes: las medidas sueltas dejan de tener
            // sentido y, si quedaran, competirían con `cellSizeMm`.
            colSizesMm: null,
            rowSizesMm: null,
            cols: Array(grid.cols).fill(1),
            rows: Array(grid.rows).fill(1)
         };
      });

      this._toasts?.show(
         `${product.name}: entran ${grid.total} por hoja (${grid.cols}×${grid.rows})`,
         { type: 'success' }
      );
   }

   _setCustomGrid(cols, rows) {
      const c = Math.max(1, Math.min(12, Math.round(Number(cols) || 1)));
      const r = Math.max(1, Math.min(12, Math.round(Number(rows) || 1)));
      const tpl = this._templates.ensureGrid(c, r);

      this._setTemplate(tpl);
      this._toasts?.show(
         `Grilla personalizada ${c} × ${r}`,
         { type: 'success', duration: 1800 }
      );
   }

   _setCustomPreset({ marginMm, gapMm } = {}) {
      const preset = this._templates.ensurePreset(marginMm, gapMm);
      if (preset.id === this._sheet().presetId) return;

      this._pushHistory();
      this._commitSheet((s) => ({ ...s, presetId: preset.id }));
      this._toasts?.show(
         `Márgenes personalizados · ${preset.marginMm} mm / ${preset.gapMm} mm`,
         { type: 'success', duration: 1800 }
      );
   }

   _setTemplate(t) {
      this._pushHistory();
      this._commitSheet((s) => {
         const cleaned = this._placeSvc.cleanupPlacement(s, t.cols * t.rows);
         return {
            ...cleaned,
            templateId: t.id,
            // Elegir una plantilla libera el tamaño fijo: las celdas vuelven a
            // estirarse para llenar la hoja.
            productId: null,
            cellSizeMm: null,
            colSizesMm: null,
            rowSizesMm: null,
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

      // La cáscara (carril + acciones) se arma una sola vez. Rehacerla en cada
      // commit reiniciaba el scroll horizontal y reenganchaba listeners.
      if (!this._$sheetsRail || !bar.contains(this._$sheetsRail)) {
         this._buildSheetsBarShell(bar);
      }

      const rail = this._$sheetsRail;
      const scroll = rail.scrollLeft;
      rail.replaceChildren(...s.sheets.map((sh, i) => this._buildSheetChip(sh, i, s)));
      // Conservar la posición del carril entre renders (colocar una imagen,
      // cambiar la escala, etc. no debe devolverlo al inicio).
      rail.scrollLeft = scroll;

      if (this._$sheetsOverviewBtn) {
         this._$sheetsOverviewBtn.hidden = s.sheets.length < 5;
         this._$sheetsOverviewBtn.textContent = `Hojas (${s.sheets.length})`;
      }

      const activeChanged = this._lastActiveSheetId !== s.activeId;
      this._lastActiveSheetId = s.activeId;
      // La selección es por celda de la hoja activa: al cambiar de hoja no
      // debe quedar apuntando a un slot de la anterior.
      if (activeChanged) {
         this._selectedSlots.clear();
         this._selectionAnchor = null;
      }
      // Se hace también sincrónico (no solo en rAF) para que funcione cuando la
      // pestaña está en segundo plano y el navegador suspende los frames.
      if (activeChanged) this._scrollActiveSheetIntoView();
      this._updateSheetRailFades();
      requestAnimationFrame(() => {
         if (activeChanged) this._scrollActiveSheetIntoView();
         this._updateSheetRailFades();
      });
   }

   _buildSheetsBarShell(bar) {
      bar.replaceChildren();
      this._sheetRailObserver?.disconnect();

      const wrap = document.createElement('div');
      wrap.className = 'layoutssection__sheetsrailwrap';

      const rail = document.createElement('div');
      rail.className = 'layoutssection__sheetsrail';
      rail.setAttribute('role', 'group');
      rail.setAttribute('aria-label', 'Hojas de la plantilla');
      rail.addEventListener('scroll', () => this._updateSheetRailFades(), { passive: true });
      wrap.appendChild(rail);

      const actions = document.createElement('div');
      actions.className = 'layoutssection__sheetactions';

      // Dos acciones bien separadas: crear en blanco vs. copiar la activa.
      // Viven fuera del carril para que sigan visibles con muchas hojas.
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'layoutssection__sheetaction';
      add.textContent = '+ Nueva hoja';
      add.setAttribute('data-tooltip', 'Hoja vacía con la misma configuración que la actual');
      add.addEventListener('click', () => this.addSheet());

      const dup = document.createElement('button');
      dup.type = 'button';
      dup.className = 'layoutssection__sheetaction layoutssection__sheetaction--dup';
      dup.textContent = '⧉ Duplicar';
      dup.setAttribute('data-tooltip', 'Copia la hoja actual con sus ajustes e imágenes');
      dup.addEventListener('click', () => this.duplicateSheet(this._state.activeId));

      // Con muchas hojas el carril scrollea; este menú da una vista completa
      // de todas las hojas (nombre + ocupación) sin tener que recorrerlo.
      const overview = document.createElement('button');
      overview.type = 'button';
      overview.className = 'layoutssection__sheetaction layoutssection__sheetaction--overview';
      overview.hidden = true;
      overview.setAttribute('data-tooltip', 'Ver todas las hojas');
      overview.addEventListener('click', (e) => {
         // Sin stopPropagation, el listener de click del ContextMenu (que
         // cierra al clickear fuera) cerraría el menú recién abierto.
         e.stopPropagation();
         const rect = overview.getBoundingClientRect();
         this._showSheetsOverview(rect.left, rect.bottom + 6);
      });

      actions.append(add, dup, overview);
      bar.append(wrap, actions);

      this._$sheetsRailWrap = wrap;
      this._$sheetsRail = rail;
      this._$sheetsOverviewBtn = overview;

      // El ancho del carril cambia al montar la sección, al redimensionar la
      // ventana y al mostrarse tras estar oculta. Sin esto, el render inicial
      // podía medir 0 y los fades quedaban apagados hasta el próximo commit.
      if (typeof ResizeObserver !== 'undefined') {
         this._sheetRailObserver = new ResizeObserver(() => {
            this._updateSheetRailFades();
            this._scrollActiveSheetIntoView();
         });
         this._sheetRailObserver.observe(rail);
      }

      this._tips?.scope(bar);
   }

   _buildSheetChip(sh, i, s) {
      const used = this._placeSvc.countUsedInSheet(sh);
      const capacity = this._sheetSvc.getCapacity(sh.templateId);
      const displayName = sh.name || `Hoja ${i + 1}`;
      const renaming = this._renamingSheetId === sh.id;

      const chip = document.createElement('div');
      chip.className = 'layoutssection__sheetchip' + (sh.id === s.activeId ? ' is-active' : '');
      chip.dataset.sheetId = sh.id;

      chip.addEventListener('contextmenu', (e) => {
         e.preventDefault();
         this._showSheetMenu(e, sh, i);
      });

      // Mientras se renombra, el chip no puede ser un <button> (un input dentro
      // de un button es HTML inválido); el div reusa el mismo estilo.
      const main = document.createElement(renaming ? 'div' : 'button');
      main.className = 'layoutssection__sheetchip-main';

      if (!renaming) {
         main.type = 'button';
         main.setAttribute('aria-current', sh.id === s.activeId ? 'page' : 'false');
         main.title = 'Clic para activar · doble clic para renombrar · clic derecho para más';
         main.addEventListener('click', () => {
            // No re-renderizar si ya es la activa: el primer click de un doble
            // click reemplazaría el chip y el dblclick (renombrar) no llegaría.
            if (sh.id !== this._state.activeId) this._ctx.patch({ activeId: sh.id });
         });
         main.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._beginRenameSheet(sh);
         });
      }

      const count = document.createElement('small');
      count.className = 'layoutssection__sheetchip-count';
      count.textContent = `${used}/${capacity}`;

      if (renaming) {
         const input = document.createElement('input');
         input.type = 'text';
         input.className = 'layoutssection__sheetrename';
         input.value = sh.name || '';
         input.placeholder = displayName;
         input.setAttribute('aria-label', `Nombre de ${displayName}`);
         // El chip tiene click para activar la hoja; el input no debe dispararlo.
         input.addEventListener('pointerdown', (e) => e.stopPropagation());
         input.addEventListener('click', (e) => e.stopPropagation());

         let done = false;
         const finish = (cancel = false) => {
            if (done) return;
            done = true;
            this._renamingSheetId = null;
            if (cancel) this.renderSheetsBar();
            else this.renameSheet(sh.id, input.value);
         };

         input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
               e.preventDefault();
               finish();
            } else if (e.key === 'Escape') {
               e.preventDefault();
               finish(true);
            }
         });
         input.addEventListener('blur', () => finish());

         main.append(input, count);
         requestAnimationFrame(() => {
            input.focus();
            input.select();
         });
      } else {
         const label = document.createElement('span');
         label.textContent = displayName;
         main.append(label, count);
      }

      chip.appendChild(main);

      if (s.sheets.length > 1) {
         const del = document.createElement('button');
         del.type = 'button';
         del.className = 'layoutssection__sheetchip-del';
         del.textContent = '×';
         del.setAttribute('aria-label', `Eliminar ${displayName}`);
         del.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeSheet(sh.id);
         });
         chip.appendChild(del);
      }

      return chip;
   }

   _beginRenameSheet(sh) {
      this._renamingSheetId = sh.id;
      this.renderSheetsBar();
   }

   renameSheet(id, name) {
      const current = this._state.sheets.find((sheet) => sheet.id === id);
      const clean = String(name ?? '').trim();
      if (!current) return;

      if ((current.name || '') === clean) {
         this.renderSheetsBar();
         return;
      }

      this._pushHistory();
      this._ctx.set((prev) => ({
         ...prev,
         sheets: this._sheetSvc.renameSheet(prev.sheets, id, clean)
      }));
   }

   moveSheet(id, toIndex) {
      const sheets = this._state.sheets;
      const from = sheets.findIndex((sheet) => sheet.id === id);
      if (from < 0) return;

      const target = Math.max(0, Math.min(sheets.length - 1, Math.trunc(toIndex)));
      if (from === target) return;

      this._pushHistory();
      this._ctx.set((prev) => ({
         ...prev,
         sheets: this._sheetSvc.moveSheet(prev.sheets, id, target)
      }));
      this._toasts?.show(`Hoja movida a la posición ${target + 1}`, {
         type: 'info',
         duration: 1400
      });
   }

   _showSheetMenu(e, sh, index) {
      const items = [
         {
            label: 'Renombrar hoja',
            icon: 'pen-tool',
            action: () => this._beginRenameSheet(sh)
         }
      ];

      if (index > 0) {
         items.push({
            label: 'Mover a la izquierda',
            icon: 'arrow-left',
            action: () => this.moveSheet(sh.id, index - 1)
         });
      }
      if (index < this._state.sheets.length - 1) {
         items.push({
            label: 'Mover a la derecha',
            icon: 'arrow-right',
            action: () => this.moveSheet(sh.id, index + 1)
         });
      }

      items.push({ type: 'separator' });
      items.push({
         label: 'Duplicar hoja',
         icon: 'copy',
         action: () => this.duplicateSheet(sh.id)
      });

      if (this._state.sheets.length > 1) {
         items.push({
            label: 'Eliminar hoja',
            icon: 'minus',
            danger: true,
            action: () => this.removeSheet(sh.id)
         });
      }

      this._cmenu?.open({ x: e.clientX, y: e.clientY, items });
   }

   /** Menú de desborde: todas las hojas con su ocupación, sin recorrer el carril. */
   _showSheetsOverview(x, y) {
      const s = this._state;
      const items = s.sheets.map((sh, i) => {
         const used = this._placeSvc.countUsedInSheet(sh);
         const capacity = this._sheetSvc.getCapacity(sh.templateId);
         const active = sh.id === s.activeId;
         return {
            label: `${sh.name || `Hoja ${i + 1}`} · ${used}/${capacity}${active ? ' · activa' : ''}`,
            icon: active ? 'check' : 'file-text',
            action: () => this._ctx.patch({ activeId: sh.id })
         };
      });

      this._cmenu?.open({ x, y, items });
   }

   /** Mantiene visible la hoja activa sin mover la página. */
   _scrollActiveSheetIntoView() {
      const rail = this._$sheetsRail;
      if (!rail) return;
      const active = rail.querySelector('.layoutssection__sheetchip.is-active');
      if (!active) return;

      const pad = 10;
      const left = active.offsetLeft;
      const right = left + active.offsetWidth;
      if (left < rail.scrollLeft + pad) {
         rail.scrollLeft = Math.max(0, left - pad);
      } else if (right > rail.scrollLeft + rail.clientWidth - pad) {
         rail.scrollLeft = right - rail.clientWidth + pad;
      }
      this._updateSheetRailFades();
   }

   /** Fades laterales solo cuando el carril tiene contenido fuera de vista. */
   _updateSheetRailFades() {
      const wrap = this._$sheetsRailWrap;
      const rail = this._$sheetsRail;
      if (!wrap || !rail) return;

      const max = rail.scrollWidth - rail.clientWidth;
      const scrollable = max > 1;
      wrap.classList.toggle('is-scrollable', scrollable);
      wrap.classList.toggle('has-start-fade', scrollable && rail.scrollLeft > 1);
      wrap.classList.toggle('has-end-fade', scrollable && rail.scrollLeft < max - 1);
   }

   /**
    * Hoja NUEVA: en blanco, pero **con la configuración de la hoja activa**.
    *
    * El contenido no se copia (para eso está `duplicateSheet`): heredar papel,
    * plantilla, márgenes, ajuste, escala, producto y pesos de columnas/filas es
    * lo que se espera de "otra hoja igual". Antes arrancaba con los valores por
    * defecto del catálogo y el usuario tenía que reconfigurar cada hoja.
    */
   addSheet() {
      let creada = null;

      this._pushHistory();
      // `set` REEMPLAZA el estado: sin esparcir `prev` acá se perdían el pool
      // de imágenes y el zoom cada vez que se creaba una hoja.
      this._ctx.set((prev) => {
         const actual = this._sheetSvc.getActiveSheet(prev);
         const fresh = this._sheetSvc.createSheet(prev.sheets.length + 1, actual);
         creada = fresh;

         const index = prev.sheets.findIndex((sh) => sh.id === prev.activeId);
         const sheets = [...prev.sheets];
         // Al lado de la actual: la planilla conserva el orden en que se armó.
         sheets.splice(index < 0 ? sheets.length : index + 1, 0, fresh);
         return { ...prev, activeId: fresh.id, sheets };
      });

      const pos = this._state.sheets.findIndex((sh) => sh.id === creada?.id) + 1;
      this._toasts?.show(
         `Hoja ${pos || this._state.sheets.length} creada con la configuración de la anterior`,
         { type: 'success' }
      );
   }

   /** Copia exacta de una hoja: ajustes, medidas de celda e imágenes colocadas. */
   duplicateSheet(id) {
      this._pushHistory();
      this._ctx.set((prev) => {
         const index = prev.sheets.findIndex((sh) => sh.id === id);
         if (index < 0) return prev;

         const src = prev.sheets[index];
         const copy = {
            ...src,
            id: `sheet-${prev.sheets.length + 1}-${Date.now()}`,
            // Un nombre explícito se duplica con sufijo para no tener dos
            // chips “Tapa” indistinguibles.
            name: src.name ? `${src.name} (copia)` : undefined,
            placement: { ...src.placement },
            cols: Array.isArray(src.cols) ? [...src.cols] : src.cols,
            rows: Array.isArray(src.rows) ? [...src.rows] : src.rows,
            // Medidas exactas: copia propia, si no editar la copia deforma la
            // hoja original (mismo motivo que cols/rows).
            colSizesMm: Array.isArray(src.colSizesMm) ? [...src.colSizesMm] : src.colSizesMm,
            rowSizesMm: Array.isArray(src.rowSizesMm) ? [...src.rowSizesMm] : src.rowSizesMm
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
      this._pushHistory();
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
         // Si la cáscara se rearma, el paginador anterior queda huérfano:
         // liberar la instancia antes de reemplazar el contenido.
         if (this._$poolPager) {
            slice.controller.destroyComponent(this._$poolPager.sliceId || 'pool-pagination');
            this._$poolPager = null;
         }
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
         clear.setAttribute('data-tooltip', 'Elimina todas las imágenes y deja una hoja en blanco');
         clear.addEventListener('click', () => this.clearPool());
         header.appendChild(clear);

         this._$galleryGrid = document.createElement('div');
         this._$galleryGrid.className = 'layoutspanel__gallery';

         this._$gallerySearch = document.createElement('input');
         this._$gallerySearch.type = 'search';
         this._$gallerySearch.className = 'layoutspanel__gallery-search';
         this._$gallerySearch.placeholder = 'Buscar imagen…';
         this._$gallerySearch.setAttribute('aria-label', 'Buscar imagen en la biblioteca');
         this._$gallerySearch.value = this._poolQuery;
         this._$gallerySearch.addEventListener('input', () => {
            this._poolQuery = this._$gallerySearch.value;
            this._poolPage = 1;
            this.renderGallery();
         });

         this._$galleryEmpty = document.createElement('p');
         this._$galleryEmpty.className = 'layoutspanel__gallery-empty';
         this._$galleryEmpty.hidden = true;

         this._$galleryPager = document.createElement('div');
         this._$galleryPager.className = 'layoutspanel__gallery-pager';
         this._$galleryPager.hidden = true;

         host.append(
            header,
            this._$gallerySearch,
            this._$galleryGrid,
            this._$galleryEmpty,
            this._$galleryPager
         );
      }

      const query = this._poolQuery.trim();
      const normalized = query.toLowerCase();
      const filtered = normalized
         ? s.pool.filter((asset) => String(asset.name || '').toLowerCase().includes(normalized))
         : s.pool;

      this._$galleryTitle.textContent = normalized
         ? `Biblioteca (${filtered.length}/${s.pool.length})`
         : `Biblioteca (${s.pool.length})`;

      // Mantiene el input en sincronía cuando la query se limpia por código
      // (subir imágenes, vaciar la biblioteca).
      if (this._$gallerySearch.value !== this._poolQuery) {
         this._$gallerySearch.value = this._poolQuery;
      }

      const empty = s.pool.length > 0 && filtered.length === 0;
      this._$galleryEmpty.hidden = !empty;
      this._$galleryEmpty.textContent = empty
         ? `No hay imágenes que coincidan con “${query}”.`
         : '';

      // La página se recorta cuando el pool (o el filtro) se achica para no
      // quedar en una página sin miniaturas.
      const totalPages = Math.max(1, Math.ceil(filtered.length / POOL_PAGE_SIZE));
      this._poolPage = Math.min(Math.max(1, this._poolPage), totalPages);
      const start = (this._poolPage - 1) * POOL_PAGE_SIZE;
      const pageAssets = filtered.slice(start, start + POOL_PAGE_SIZE);

      // Serializado: renderGallery() se dispara en cada commit del contexto sin
      // que nadie la espere, y dos pasadas concurrentes construirían dos veces
      // la PoolCard de un mismo asset.
      this._galleryChain = (this._galleryChain || Promise.resolve())
         .then(async () => {
            // Un fallo del paginador no debe dejar la biblioteca en blanco.
            try {
               await this._syncPoolPager(filtered.length);
            } catch (err) {
               slice.logger?.logWarn?.('LayoutsSection', 'Pool pagination failed', err);
            }
            await this._renderPoolCards(this._$galleryGrid, pageAssets,
               this._placeSvc.usedAssetIds(this._sheet()));
         })
         .catch((err) => {
            slice.logger?.logError?.('LayoutsSection', 'Gallery render failed', err);
         });

      return this._galleryChain;
   }

   /**
    * Crea una sola vez el paginador del pool y lo sincroniza con el tamaño
    * actual. Debajo de una página no se muestra (el header ya dice el total).
    */
   async _syncPoolPager(totalItems) {
      const host = this._$galleryPager;
      if (!host) return;

      const visible = totalItems > POOL_PAGE_SIZE;
      host.hidden = !visible;
      if (!visible) return;

      if (!this._$poolPager) {
         this._$poolPager = await slice.build('Pagination', {
            sliceId: 'pool-pagination',
            size: 'sm',
            variant: 'ghost',
            mode: 'compact',
            align: 'between',
            showInfo: true,
            showFirstLast: false,
            showLabels: false,
            controlled: true,
            pageSize: POOL_PAGE_SIZE,
            currentPage: this._poolPage,
            totalItems,
            texts: {
               label: 'Páginas de la biblioteca',
               previous: 'Anterior',
               next: 'Siguiente',
               previousPage: 'Página anterior',
               nextPage: 'Página siguiente',
               page: 'Página {page}',
               pageOf: 'Página {page} de {total}',
               info: '{from}–{to} de {total}',
               empty: 'Sin imágenes'
            },
            onPageChange: (page) => {
               this._poolPage = page;
               this.renderGallery();
            }
         });
         if (!this._$poolPager) return;
         host.appendChild(this._$poolPager);
      }

      const pager = this._$poolPager;
      // Los setters repintan; solo tocar lo que cambió evita renders de más.
      if (pager.totalItems !== totalItems) pager.totalItems = totalItems;
      if (pager.currentPage !== this._poolPage) pager.currentPage = this._poolPage;
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

   /**
    * Guarda el crop (zoom/encuadre) en el ASSET, no en el placement: todas las
    * copias de la misma imagen comparten el mismo encuadre en todas las hojas.
    * Se debouncea la escritura del blob en IndexedDB.
    */
   _setPlacementCrop(slotIdx, { cropX, cropY, cropScale }) {
      const ref = this._sheet().placement?.[slotIdx];
      if (!ref?.refId) return;

      const asset = this._asset(ref.refId);
      if (!asset) return;

      const next = {
         cropScale: cropScale ?? asset.cropScale ?? 1,
         cropX: cropX ?? asset.cropX ?? 0.5,
         cropY: cropY ?? asset.cropY ?? 0.5
      };

      if (asset.cropScale === next.cropScale
         && asset.cropX === next.cropX
         && asset.cropY === next.cropY) {
         return;
      }

      this._ctx.set((prev) => ({
         ...prev,
         pool: prev.pool.map((a) => (a.id === asset.id ? { ...a, ...next } : a))
      }));

      clearTimeout(this._cropTimers.get(asset.id));
      this._pendingCrops.set(asset.id, next);
      this._cropTimers.set(asset.id, setTimeout(() => {
         this._cropTimers.delete(asset.id);
         const crop = this._pendingCrops.get(asset.id);
         this._pendingCrops.delete(asset.id);
         this._storage?.updateAssetCrop?.(asset.id, crop);
      }, 400));
   }

   /** Selección simple, Ctrl/Cmd para toggle y Shift para rango. */
   _onCellSelect(slotIdx, event = null) {
      const toggle = !!(event?.ctrlKey || event?.metaKey);
      const range = !!event?.shiftKey;
      this._selectSlot(slotIdx, { toggle, range });
   }

   _selectSlot(slotIdx, { toggle = false, range = false } = {}) {
      if (range && this._selectionAnchor !== null) {
         const start = Math.min(this._selectionAnchor, slotIdx);
         const end = Math.max(this._selectionAnchor, slotIdx);
         this._selectedSlots = new Set();
         for (let slot = start; slot <= end; slot++) this._selectedSlots.add(slot);
      } else if (toggle) {
         if (this._selectedSlots.has(slotIdx)) this._selectedSlots.delete(slotIdx);
         else this._selectedSlots.add(slotIdx);
         this._selectionAnchor = slotIdx;
      } else {
         this._selectedSlots = new Set([slotIdx]);
         this._selectionAnchor = slotIdx;
      }

      this._refreshCellSelection();
   }

   _onCellFocus(slotIdx) {
      // La navegación con flechas ya resuelve la selección (incluido el rango):
      // si el foco también la resetea, se pierde el ancla de Shift.
      if (this._navigatingGrid) return;
      this._selectSlot(slotIdx);
   }

   _handleGridKey(e) {
      if (e.target?.closest?.('.sheetcell__zoom')) return;
      const cellEl = e.target?.closest?.('slice-sheet-cell');
      if (!cellEl) return;

      const key = e.key;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
         return;
      }

      e.preventDefault();
      const cells = [...this.$refs.sheet.querySelectorAll('slice-sheet-cell')];
      const index = cells.indexOf(cellEl);
      if (index < 0) return;

      const cols = this._templates.get(this._sheet().templateId).cols;
      let next = index;
      if (key === 'ArrowLeft') next = Math.max(0, index - 1);
      else if (key === 'ArrowRight') next = Math.min(cells.length - 1, index + 1);
      else if (key === 'ArrowUp') next = Math.max(0, index - cols);
      else if (key === 'ArrowDown') next = Math.min(cells.length - 1, index + cols);
      else if (key === 'Home') next = 0;
      else if (key === 'End') next = cells.length - 1;

      this._navigatingGrid = true;
      cells[next]?.querySelector('.sheetcell')?.focus();
      this._navigatingGrid = false;
      this._selectSlot(next, { range: e.shiftKey });
   }

   /** Ctrl/Cmd+A: selecciona todas las celdas de la hoja activa. */
   _selectAllCells() {
      const tpl = this._templates.get(this._sheet().templateId);
      const capacity = tpl.cols * tpl.rows;
      this._selectedSlots = new Set(
         Array.from({ length: capacity }, (_, slot) => slot)
      );
      this._selectionAnchor = 0;
      this._refreshCellSelection();
   }

   _deselectAll() {
      if (!this._selectedSlots.size && this._selectionAnchor === null) return;
      this._clearSelection();
   }

   _refreshCellSelection() {
      const cells = this.$refs.sheet?.querySelectorAll('slice-sheet-cell') || [];
      for (const cell of cells) {
         const slot = Number(cell.dataset?.slot ?? cell.querySelector('.sheetcell')?.dataset?.slot);
         if (Number.isFinite(slot)) {
            cell.selected = this._selectedSlots.has(slot);
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
         // Con celdas de tamaño fijo la grilla no llena la hoja: lo que sobra
         // queda libre. El eje con medidas exactas se ancla al margen (no se
         // mueve al editar otras celdas) y el eje con pesos sigue estirándose.
         justifyContent: geo.colCentered ? 'center' : 'stretch',
         alignContent: geo.rowCentered ? 'center' : 'stretch'
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
            // El crop vive en el asset; el fallback a `ref` mantiene sesiones
            // viejas hasta que se migran en _restoreSession.
            cropX: asset.cropX ?? ref?.cropX ?? 0.5,
            cropY: asset.cropY ?? ref?.cropY ?? 0.5,
            cropScale: asset.cropScale ?? ref?.cropScale ?? 1
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
                selected: this._selectedSlots.has(idx),
                onFocus: (slotIdx) => this._onCellFocus(slotIdx)
             });
          } else {
             cell = await slice.build('SheetCell', {
                sliceId: id,
                slot: idx,
                col: idx % tpl.cols,
                row: Math.floor(idx / tpl.cols),
                img,
                imageScale: sheet.imageScale ?? 1,
                selected: this._selectedSlots.has(idx),
                animate: idx === this._lastAnimatedSlot,
                onPick: (slotIdx) => this._onEmptyCellClick(slotIdx),
                onRemove: (slotIdx) => this.removePlacement(slotIdx),
                onMenu: (info) => this._showInfoMenu(info.nativeEvent, info),
                onSelect: (slotIdx, event) => this._onCellSelect(slotIdx, event),
                onFocus: (slotIdx) => this._onCellFocus(slotIdx),
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
      const cropScale = asset.cropScale ?? ref.cropScale ?? 1;
      const cropX = asset.cropX ?? ref.cropX ?? 0.5;
      const cropY = asset.cropY ?? ref.cropY ?? 0.5;

      Object.assign(cell.style, {
         backgroundImage: `url("${asset.url}")`,
         backgroundPosition: cropScale > 1
            ? `${cropX * 100}% ${cropY * 100}%`
            : 'center',
         backgroundRepeat: 'no-repeat',
         backgroundSize: cropScale > 1
            ? `${cropScale * 100}%`
            : (imgScale < 1
               ? `${imgScale * 100}%`
               : (ref.fit === 'contain' ? 'contain' : 'cover'))
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
         tpl, page, preset, sheet.cols, sheet.rows, sheet.cellSizeMm,
         { colsMm: sheet.colSizesMm, rowsMm: sheet.rowSizesMm }
      );
   }

   // ---------- splitters ----------

   _renderSplitters(host, geo, tpl, preset) {
      host.querySelectorAll('.layoutssection__splitter').forEach((el) => el.remove());

      // Con un producto elegido la celda mide lo que mide: ambos ejes están
      // bloqueados y no hay nada que repartir.
      if (geo.fixed) return;

      const makeHandle = (axis, k) => {
         const h = document.createElement('div');
         h.className = `layoutssection__splitter layoutssection__splitter--${axis}`;
         h.dataset.axis = axis;
         h.dataset.k = String(k);
         h.addEventListener('pointerdown', (e) => this._beginBoundaryDrag(e, axis, k));
         h.addEventListener('dblclick', () => {
            // Doble click: repartir ese eje en partes iguales y volver a
            // estirarlo hasta los márgenes (sale del modo de medidas exactas
            // solo en ese eje).
            this._commitSheet((s) => (axis === 'v'
               ? { ...s, cols: Array(tpl.cols).fill(1), colSizesMm: null }
               : { ...s, rows: Array(tpl.rows).fill(1), rowSizesMm: null }));
         });
         return h;
      };

      for (let k = 1; k < tpl.cols; k++) host.appendChild(makeHandle('v', k));
      for (let k = 1; k < tpl.rows; k++) host.appendChild(makeHandle('h', k));

      this._positionSplitters(host, geo, preset);
   }

   _positionSplitters(host, geo, preset) {
      const gapPx = preset.gapMm * PX_PER_MM;
      // Con medidas exactas / producto la grilla no llena la hoja: los
      // tiradores se ubican desde el origen real, no desde el margen asumido.
      const originX = (Number.isFinite(geo.originXMm) ? geo.originXMm : preset.marginMm) * PX_PER_MM;
      const originY = (Number.isFinite(geo.originYMm) ? geo.originYMm : preset.marginMm) * PX_PER_MM;
      const gridW = (Number.isFinite(geo.gridW) ? geo.gridW
         : geo.colWmm.reduce((a, b) => a + b, 0) + preset.gapMm * (geo.colWmm.length - 1)) * PX_PER_MM;
      const gridH = (Number.isFinite(geo.gridH) ? geo.gridH
         : geo.rowHmm.reduce((a, b) => a + b, 0) + preset.gapMm * (geo.rowHmm.length - 1)) * PX_PER_MM;

      host.querySelectorAll('.layoutssection__splitter').forEach((h) => {
         const axis = h.dataset.axis;
         const k = Number(h.dataset.k);

         if (axis === 'v') {
            const left = originX
               + geo.colWmm.slice(0, k).reduce((a, b) => a + b, 0) * PX_PER_MM
               + gapPx * k - HOLD_DRAG_PX / 2;
            Object.assign(h.style, {
               left: `${left}px`,
               top: `${originY}px`,
               height: `${gridH}px`,
               width: `${HOLD_DRAG_PX}px`
            });
         } else {
            const top = originY
               + geo.rowHmm.slice(0, k).reduce((a, b) => a + b, 0) * PX_PER_MM
               + gapPx * k - HOLD_DRAG_PX / 2;
            Object.assign(h.style, {
               top: `${top}px`,
               left: `${originX}px`,
               width: `${gridW}px`,
               height: `${HOLD_DRAG_PX}px`
            });
         }
      });
   }

   _beginBoundaryDrag(event, axis, k) {
      // Sin preventDefault en pointerdown: cancelarlo suprime los eventos de
      // mouse compatibles y el dblclick del splitter nunca llegaba. El texto se
      // protege desactivando la selección mientras dura el arrastre.
      const sheet = this._sheet();
      // Tamaño de producto fijo: los dos ejes están bloqueados.
      if (sheet.cellSizeMm) return;

      const previousUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';

      const tpl = this._templates.get(sheet.templateId);
      const page = this._templates.page(sheet.pageId);
      const preset = this._templates.preset(sheet.presetId);
      const geo = this._cellGeometry(sheet, tpl, page, preset);

      // Un eje con medidas exactas mueve el límite entre las dos celdas
      // contiguas conservando el total; un eje con pesos redistribuye esos
      // mismos dos pesos. En ambos casos el resto de las celdas no se toca.
      const exactAxis = axis === 'v' ? geo.colFixed : geo.rowFixed;
      const base = exactAxis
         ? (axis === 'v' ? [...geo.colWmm] : [...geo.rowHmm])
         : (axis === 'v' ? [...geo.cols] : [...geo.rows]);

      const host = this.$refs.sheet;
      const startPos = axis === 'v' ? event.clientX : event.clientY;
      const unit = exactAxis
         ? 1
         : (axis === 'v' ? geo.colWmm[k - 1] / base[k - 1] : geo.rowHmm[k - 1] / base[k - 1]);

      let latest = base;
      let frame = 0;

      const apply = (values) => {
         const preview = this._geom.geometry(
            tpl, page, preset,
            axis === 'v' && !exactAxis ? values : sheet.cols,
            axis === 'h' && !exactAxis ? values : sheet.rows,
            null,
            {
               colsMm: axis === 'v' && exactAxis ? values : sheet.colSizesMm,
               rowsMm: axis === 'h' && exactAxis ? values : sheet.rowSizesMm
            }
         );
         host.style.gridTemplateColumns = preview.colWmm.map((w) => `${w * PX_PER_MM}px`).join(' ');
         host.style.gridTemplateRows = preview.rowHmm.map((h) => `${h * PX_PER_MM}px`).join(' ');
         this._positionSplitters(host, preview, preset);
      };

      const onMove = (ev) => {
         const zoom = this._state.zoom ?? ZOOM_DEFAULT;
         const delta = ((axis === 'v' ? ev.clientX : ev.clientY) - startPos) / (PX_PER_MM * zoom);

         const next = [...base];

         if (exactAxis) {
            let a = base[k - 1] + delta;
            let b = base[k] - delta;
            if (a < MIN_CELL_MM) { b += MIN_CELL_MM - a; a = MIN_CELL_MM; }
            if (b < MIN_CELL_MM) { a += MIN_CELL_MM - b; b = MIN_CELL_MM; }
            next[k - 1] = a;
            next[k] = b;
         } else {
            let wA = base[k - 1] + delta / unit;
            let wB = base[k] - delta / unit;
            if (wA < MIN_WEIGHT) { wB += MIN_WEIGHT - wA; wA = MIN_WEIGHT; }
            if (wB < MIN_WEIGHT) { wA += MIN_WEIGHT - wB; wB = MIN_WEIGHT; }
            next[k - 1] = wA;
            next[k] = wB;
         }
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
         document.body.style.userSelect = previousUserSelect;

         // Sin movimiento no se commitea: re-renderizar la hoja reemplazaría
         // el splitter entre los dos clicks y el dblclick nunca llegaría.
         const changed = latest.some((value, index) => Math.abs(value - base[index]) > 1e-9);
         if (!changed) return;

         this._commitSheet((s) => {
            if (exactAxis) {
               return axis === 'v'
                  ? { ...s, colSizesMm: [...latest] }
                  : { ...s, rowSizesMm: [...latest] };
            }
            return axis === 'v'
               ? { ...s, cols: [...latest] }
               : { ...s, rows: [...latest] };
         });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
   }

   // ---------- menú contextual ----------

   _showInfoMenu(e, info) {
      const { img } = info;
      const sheet = this._sheet();
      const hasExactSizes = Array.isArray(sheet.colSizesMm) || Array.isArray(sheet.rowSizesMm);

      const items = [
         {
            label: 'Editar medidas…',
            icon: 'palette',
            action: () => this._openSizeModal(info)
         }
      ];

      // En una celda vacía, pegar es la acción natural después de Ctrl+C.
      // Ctrl+V sigue funcionando sobre una celda con imagen (la reemplaza).
      if (!img && this._clipboard) {
         items.push({
            label: 'Pegar aquí',
            icon: 'copy',
            action: () => this._pasteIntoSlot(info.slot)
         });
      }

      // Acciones en lote cuando hay más de una celda seleccionada.
      if (this._selectedSlots.size > 1 && this._selectedSlots.has(info.slot)) {
         const count = this._selectedSlots.size;
         items.push(
            {
               label: `Ajuste: cubrir (${count})`,
               icon: 'image',
               action: () => this._setFitForSelected('cover')
            },
            {
               label: `Ajuste: contener (${count})`,
               icon: 'align-center',
               action: () => this._setFitForSelected('contain')
            },
            {
               label: `Quitar ${count} celdas`,
               icon: 'minus',
               danger: true,
               action: () => this._removeSelected()
            },
            { type: 'separator' }
         );
      }

      // Salida del modo "medidas exactas": las celdas vuelven a estirarse para
      // llenar la hoja. Sin esta acción, la única forma de volver era cambiar
      // de plantilla o de papel.
      if (hasExactSizes) {
         items.push({
            label: 'Ajustar celdas a la hoja',
            icon: 'expand',
            action: () => this._fitCellsToSheet()
         });
      }

      if (img) {
         items.push({ type: 'separator' });
         items.push({
            label: 'Recortar',
            icon: 'image',
            action: () => this._openCropModal(info)
         });
         items.push({
            label: 'Editar',
            icon: 'palette',
            action: () => this._openEditModal(info)
         });
         items.push({
            label: 'Reemplazar imagen…',
            icon: 'refresh',
            action: () => this._pickForSlot(info.slot)
         });
         items.push({ type: 'separator' });
         items.push({
            label: 'Rotar 90° izquierda',
            action: () => this._rotateAsset(img.id, -90)
         });
         items.push({
            label: 'Rotar 90° derecha',
            action: () => this._rotateAsset(img.id, 90)
         });
         items.push({ type: 'separator' });
         items.push({
            label: 'Voltear horizontal',
            action: () => this._flipAsset(img.id, 'horizontal')
         });
         items.push({
            label: 'Voltear vertical',
            action: () => this._flipAsset(img.id, 'vertical')
         });
         items.push({ type: 'separator' });
         items.push({
            label: 'Quitar de la celda',
            icon: 'minus',
            danger: true,
            action: () => this.removePlacement(info.slot)
         });
         items.push({
            label: 'Eliminar de la biblioteca',
            icon: 'minus',
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
            icon: 'image',
            action: () => this._openCropModal({ img: asset })
         },
         {
            label: 'Editar',
            icon: 'palette',
            action: () => this._openEditModal({ img: asset })
         },
         { type: 'separator' },
         {
            label: 'Rotar 90° izquierda',
            action: () => this._rotateAsset(asset.id, -90)
         },
         {
            label: 'Rotar 90° derecha',
            action: () => this._rotateAsset(asset.id, 90)
         },
         { type: 'separator' },
         {
            label: 'Voltear horizontal',
            action: () => this._flipAsset(asset.id, 'horizontal')
         },
         {
            label: 'Voltear vertical',
            action: () => this._flipAsset(asset.id, 'vertical')
         },
         { type: 'separator' },
         {
            label: 'Eliminar de la biblioteca',
            icon: 'minus',
            danger: true,
            action: () => this.removeFromPool(asset.id)
         }
      ];

      this._cmenu?.open({ x: e.clientX, y: e.clientY, items });
   }

   _openExportModal() {
      if (!this._exportModalPromise) {
         this._exportModalPromise = (async () => {
            let modal = slice.getComponent('export-sheets-modal');
            if (!modal) {
               modal = await slice.build('ExportSheetsModal', { sliceId: 'export-sheets-modal' });
               if (modal) document.body.appendChild(modal);
            }
            return modal;
         })();
      }

      this._exportModalPromise.then((modal) => {
         if (!modal) return;

         const sheets = this._state.sheets.map((sheet, index) => ({
            id: sheet.id,
            label: sheet.name || `Hoja ${index + 1}`,
            used: this._placeSvc.countUsedInSheet(sheet),
            capacity: this._sheetSvc.getCapacity(sheet.templateId)
         }));

         modal.open({
            sheets,
            activeId: this._state.activeId,
            onExport: ({ sheetIds, format }) => {
               if (format === 'pdf') this.exportPDF({ sheetIds });
               else if (format === 'png') this.exportPNGs({ sheetIds });
               else if (format === 'print') this.printSheets({ sheetIds });
            }
         });
      });
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
            onApply: (wcm, hcm, applyOpts = {}) => {
               // Editar medidas es una acción con historial: Ctrl+Z debe
               // devolver la grilla anterior.
               this._pushHistory();
               // Medidas EXACTAS por eje: se fija el tamaño físico de esta
               // columna/fila y las demás conservan el suyo. Antes se
               // recalculaban pesos contra el ancho total de la hoja, así que
               // editar la segunda celda achicaba la primera (y en una
               // plantilla de una sola columna no cambiaba nada).
               this._commitSheet((s) => {
                  const t = this._templates.get(s.templateId);
                  const p = this._templates.page(s.pageId);
                  const pr = this._templates.preset(s.presetId);
                  const g = this._cellGeometry(s, t, p, pr);
                  const next = { ...s };

                  if (applyOpts.applyAll) {
                     // Uniforme: todas las columnas y filas con la misma medida.
                     const w = Number.isFinite(wcm) && wcm > 0
                        ? wcm * 10
                        : g.colWmm[info.col];
                     const h = Number.isFinite(hcm) && hcm > 0
                        ? hcm * 10
                        : g.rowHmm[info.row];
                     next.colSizesMm = Array(t.cols).fill(w);
                     next.rowSizesMm = Array(t.rows).fill(h);
                  } else {
                     // Al salir del modo producto hay que congelar TAMBIÉN el
                     // eje que el usuario no tocó; si no, ese eje volvería a
                     // estirarse y toda la grilla se deformaría.
                     const wasProduct = !!s.cellSizeMm;

                     if (Number.isFinite(wcm) && wcm > 0) {
                        next.colSizesMm = this._geom.applyExactSize(g.colWmm, info.col, wcm * 10);
                     } else if (wasProduct) {
                        next.colSizesMm = [...g.colWmm];
                     }
                     if (Number.isFinite(hcm) && hcm > 0) {
                        next.rowSizesMm = this._geom.applyExactSize(g.rowHmm, info.row, hcm * 10);
                     } else if (wasProduct) {
                        next.rowSizesMm = [...g.rowHmm];
                     }
                  }

                  // Un producto fija ambos ejes y taparía las medidas recién
                  // pedidas: al editar una celda se sale del modo producto.
                  next.productId = null;
                  next.cellSizeMm = null;
                  return next;
               });

               // El toast muestra la medida REAL resultante (puede diferir si la
               // medida se clampeó al mínimo o la hoja la escaló para entrar).
               const applied = this._sheet();
               const appliedGeo = this._cellGeometry(
                  applied,
                  this._templates.get(applied.templateId),
                  this._templates.page(applied.pageId),
                  this._templates.preset(applied.presetId)
               );
               const cm = (mm) => `${(mm / 10).toFixed(1)} cm`;
               const gotW = appliedGeo.colWmm[info.col] || 0;
               const gotH = appliedGeo.rowHmm[info.row] || 0;
               const reqW = Number.isFinite(wcm) && wcm > 0 ? wcm * 10 : null;
               const reqH = Number.isFinite(hcm) && hcm > 0 ? hcm * 10 : null;
               const scaled = (reqW !== null && gotW < reqW - 0.5)
                  || (reqH !== null && gotH < reqH - 0.5);
               const scope = applyOpts.applyAll ? ' en todas las celdas' : '';

               this._toasts?.show(
                  scaled
                     ? `La medida no entra en la hoja; se ajustó a ${cm(gotW)} × ${cm(gotH)}${scope}`
                     : `Medidas aplicadas: ${cm(gotW)} × ${cm(gotH)}${scope}`,
                  { type: scaled ? 'warning' : 'success', duration: scaled ? 3200 : 1600 }
               );
            }
         });
      });
   }

   /**
    * Devuelve la grilla al modo elástico: las celdas vuelven a repartirse para
    * llenar la hoja. Es la salida del modo de medidas exactas.
    */
   _fitCellsToSheet() {
      this._pushHistory();
      this._commitSheet((s) => {
         const tpl = this._templates.get(s.templateId);
         return {
            ...s,
            colSizesMm: null,
            rowSizesMm: null,
            cols: Array(tpl.cols).fill(1),
            rows: Array(tpl.rows).fill(1)
         };
      });
      this._toasts?.show('Celdas ajustadas al tamaño de la hoja', {
         type: 'info',
         duration: 1600
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
      this._pickForSlot(slot);
   }

   _pickForSlot(slot) {
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
    * Hojas que tienen al menos una imagen **resoluble** colocada.
    *
    * Exportar una hoja vacía produce una página en blanco en el PDF/PNG (y una
    * hoja de más al imprimir). Se exige que el asset exista: una hoja cuyas
    * únicas celdas apuntan a imágenes perdidas tampoco tiene nada que imprimir.
    */
   _sheetsConContenido({ activeOnly = false, sheetIds = null } = {}) {
      let base = activeOnly ? [this._sheet()] : this._state.sheets;

      if (Array.isArray(sheetIds)) {
         const selected = new Set(sheetIds);
         base = base.filter((sh) => selected.has(sh.id));
      }

      return base.filter((sh) => Object.values(sh.placement || {})
         .some((ref) => ref && this._asset(ref.refId)));
   }

   /**
    * Renderiza las hojas offscreen, corre `fn(stages)` y limpia siempre.
    * Bloquea reentradas: dos clicks seguidos duplicaban toda la exportación.
    * @param {{activeOnly?:boolean, sheetIds?:string[]|null}} [opts]
    */
   async _withStages(label, fn, { activeOnly = false, sheetIds = null } = {}) {
      if (this._exporting) return null;
      if (!this._state.sheets.length) return null;

      const sheets = this._sheetsConContenido({ activeOnly, sheetIds });
      if (!sheets.length) {
         this._toasts?.show(
            'No hay imágenes colocadas en la hoja. Usa Auto acomodar o arrastra imágenes a las celdas.',
            { type: 'warning', duration: 4000 }
         );
         return null;
      }

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

   async exportPNGs({ activeOnly = false, sheetIds = null } = {}) {
      try {
         const count = await this._withStages('Exportando PNG', (stages, onProgress) =>
            this._exportSvc.exportPNGs(stages, html2canvas, { onProgress }), { activeOnly, sheetIds });
         if (count) this._toasts?.show(`${count} hoja(s) exportadas como PNG`, { type: 'success' });
      } catch (err) {
         slice.logger?.logError?.('LayoutsSection', 'PNG export failed', err);
         this._toasts?.show('Error al exportar PNGs', { type: 'error' });
      }
   }

   /**
    * Traduce las hojas a un plan puramente geométrico en milímetros. Es lo que
    * permite que el PDF no dependa de rasterizar la hoja: cada imagen ya viene
    * con su posición y tamaño físicos resueltos.
    * @param {object[]} [sheets] - hojas a exportar (por defecto, todas)
    */
   _buildExportPlan(sheets = this._state.sheets) {
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

            const cropScale = asset.cropScale ?? ref.cropScale ?? 1;
            const cropX = asset.cropX ?? ref.cropX ?? 0.5;
            const cropY = asset.cropY ?? ref.cropY ?? 0.5;
            // Con zoom/encuadre manual la imagen llena (o desborda) la celda y
            // se recorta: el rect físico es la celda entera. El servicio de PDF
            // rasteriza esa vista para respetar el encuadre.
            const rect = cropScale > 1
               ? { xMm: cell.xMm, yMm: cell.yMm, wMm: cell.wMm, hMm: cell.hMm, crop: true }
               : this._geom.imageRect(cell, asset.ratio, ref.fit || 'cover', scale);

            items.push({
               url: asset.url,
               name: asset.name,
               cellRatio: cell.wMm / cell.hMm,
               cropScale,
               cropX,
               cropY,
               ...rect
            });
         }

         return { widthMm: page.w, heightMm: page.h, items };
      });
   }

   async exportPDF({ activeOnly = false, sheetIds = null } = {}) {
      if (this._exporting) return;
      if (!this._state.sheets.length) return;

      // Solo las hojas con contenido: una hoja vacía da una página en blanco.
      const sheets = this._sheetsConContenido({ activeOnly, sheetIds });
      if (!sheets.length) {
         this._toasts?.show(
            'No hay imágenes colocadas en la hoja. Usa Auto acomodar o arrastra imágenes a las celdas.',
            { type: 'warning', duration: 4000 }
         );
         return;
      }

      const plan = this._buildExportPlan(sheets);

      this._exporting = true;
      this._setBusy(true, 'Preparando el PDF…');

      try {
         const jsPDF = await cargarJsPDF();
         this._setBusy(true, 'Generando PDF…');

         const res = await this._exportSvc.exportPDFExact(plan, jsPDF, {
            onProgress: (done, pages) =>
               this._setBusy(true, `Generando PDF ${Math.min(done + 1, pages)}/${pages}`)
         });

         if (res && res.ok) {
            if (res.fallidas?.length) {
               this._toasts?.show(
                  `${res.fallidas.length} imagen(es) no se pudieron leer; esa(s) celda(s) puede(n) salir vacía(s).`,
                  { type: 'warning', duration: 5000 }
               );
            }
            const msg = activeOnly ? 'PDF de hoja activa generado' : 'PDF generado a tamaño real';
            this._toasts?.show(msg, { type: 'success' });
            return;
         }

         // Ninguna imagen se pudo estampar: último recurso, rasterizar cada hoja
         // (el mismo camino que PNG/Imprimir). Se pierde el vector pero el
         // usuario se lleva lo que ve en pantalla.
         slice.logger?.logWarn?.(
            'LayoutsSection',
            'El PDF exacto no pudo estampar imágenes; se rasterizan las hojas',
            res
         );
         this._setBusy(true, 'Generando PDF como imagen…');
         await this._exportPDFRaster(sheets, jsPDF);
         this._toasts?.show('PDF generado como imagen (no se pudieron leer las imágenes originales)', {
            type: 'warning',
            duration: 5000
         });
      } catch (err) {
         slice.logger?.logError?.('LayoutsSection', 'PDF export failed', err);
         this._toasts?.show(
            'No se pudo generar el PDF. Revisá la conexión y volvé a intentar.',
            { type: 'error', duration: 5000 }
         );
      } finally {
         this._setBusy(false);
         this._exporting = false;
      }
   }

   /**
    * Fallback del PDF: renderiza las hojas offscreen y las estampa enteras.
    * No usa `_withStages` porque `exportPDF` ya tiene tomado `_exporting`.
    */
   async _exportPDFRaster(sheets, jsPDF) {
      let stages = null;
      try {
         stages = await this._exportSvc.renderOffscreen(
            sheets,
            (sheet, node) => this._renderSheetInto(sheet, node, { interactive: false })
         );
         return await this._exportSvc.exportPDFRaster(stages, html2canvas, jsPDF);
      } finally {
         this._exportSvc.cleanupStages(stages);
      }
   }


   async printSheets({ activeOnly = false, sheetIds = null } = {}) {
      const sheets = this._sheetsConContenido({ activeOnly, sheetIds });
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
            //
            // printSheets() es async: espera a que el iframe decodifique las
            // imágenes antes de abrir el diálogo (si no, sale en blanco).
            const started = await this._exportSvc.printSheets(stages);
            // Un respiro para que el iframe termine de disponer el layout antes
            // de que _withStages descarte los nodos originales.
            await new Promise((r) => setTimeout(r, 300));
            return started;
         }, { activeOnly, sheetIds });
         if (!ok) this._toasts?.show('No se pudo abrir el diálogo de impresión', { type: 'error' });
      } catch (err) {
         slice.logger?.logError?.('LayoutsSection', 'Print failed', err);
         this._toasts?.show('Error al preparar la impresión', { type: 'error' });
      }
   }
}

customElements.define('slice-layouts-section', LayoutsSection);
