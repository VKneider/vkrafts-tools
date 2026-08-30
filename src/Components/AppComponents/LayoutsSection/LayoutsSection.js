import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const PX_PER_MM = 3.4;
const STEP_MS = 140;
const HOLD_DRAG_PX = 10;

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

      this._poolSvc = await slice.build('PoolService', { sliceId: 'PoolService' });
      this._placeSvc = await slice.build('PlacementService', { sliceId: 'PlacementService', geomService: this._geom });
      this._sheetSvc = await slice.build('SheetService', { sliceId: 'SheetService', templatesService: this._templates });
      this._exportSvc = await slice.build('ExportService', { sliceId: 'ExportService', templatesService: this._templates });
      this._dnd = await slice.build('DragDropService', { sliceId: 'DragDropService' });

      this._cmenu = slice.getComponent('app-context-menu');
      if (!this._cmenu) {
         this._cmenu = await slice.build('ContextMenu', { sliceId: 'app-context-menu' });
         if (this._cmenu) document.body.appendChild(this._cmenu);
      }

      this._pendingRefId = null;
      this._placing = false;
      this._renderSeq = 0;
      this._renderChain = Promise.resolve();

      await this._buildControls();

      this._watchHandle = this._ctx.bind(this, () => this.renderAll());
      await this.renderAll();

      document.addEventListener('paste', this._onPaste = (e) => {
         const files = Array.from(e.clipboardData?.items || [])
            .filter((it) => it.type.startsWith('image/'))
            .map((it) => it.getAsFile())
            .filter(Boolean);
         if (files.length) this.addFiles(files);
      });

      document.addEventListener('wheel', this._onWheel = (e) => {
         if (!e.ctrlKey) return;
         if (!e.target.closest?.('slice-layouts-section')) return;
         e.preventDefault();

         const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
         const factor = Math.exp(-dy * 0.0016);

         const prev = this._state.zoom ?? 0.7;
         const next = Math.min(3, Math.max(0.35, prev * factor));
         if (Math.abs(next - prev) > 0.001) {
            this._ctx.patch({ zoom: next });
            this.renderSheet();
         }
      }, { passive: false });
   }

   update() { return this.renderAll(); }

   beforeDestroy() {
      document.removeEventListener('paste', this._onPaste);
      document.removeEventListener('wheel', this._onWheel);
      if (this._tips) {
         this.querySelectorAll('[data-tooltip]').forEach((el) => this._tips.detach(el));
      }
      this._poolSvc?.disposeAll(this._state.pool);
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

   // ---------- construcción de controles ----------

   async _buildControls() {
      const sheet = this._sheet();

      const actionDefs = [
         { key: 'auto', label: 'Auto acomodar', icon: 'wand-sparkles', variant: 'filled', tip: 'Recoloca el pool en esta hoja según orientación y proporción', handler: () => this.smartAssign(true) },
         { key: 'clear', label: 'Limpiar hoja', icon: 'trash-2', variant: 'outlined', tip: 'Vacía las celdas (las imágenes siguen en el pool)', handler: () => this.clearPlacements() },
         { key: 'pngs', label: 'PNGs', icon: 'images', variant: 'outlined', tip: 'Descargar todas las hojas como imágenes', handler: () => this.exportPNGs() },
         { key: 'pdf', label: 'PDF', icon: 'file-text', variant: 'outlined', tip: 'Exportar todas las hojas en un PDF', handler: () => this.exportPDF() },
         { key: 'print', label: 'Imprimir', icon: 'printer', variant: 'soft', tip: 'Imprimir la hoja actual', handler: () => this.printSheet() }
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
         onScaleChange: (val) => this._commitSheet((s) => ({ ...s, imageScale: val }))
      });
      if (this._panel) this.$refs.panel.appendChild(this._panel);

      this.$refs.picker.addEventListener('change', () => {
         const slot = Number(this.$refs.picker.dataset.slot || -1);
         this.addFiles(Array.from(this.$refs.picker.files || []), {
            directSlot: slot >= 0 ? slot : null
         });
         this.$refs.picker.value = '';
      });

      this._tips?.scope(this);
   }

   // ---------- pool ----------

   async addFiles(files, { directSlot = null } = {}) {
      const assets = [];
      for (const file of files.slice(0, 30)) {
         const url = URL.createObjectURL(file);
         const size = await this._poolSvc.measure(url);
         if (!size) { URL.revokeObjectURL(url); continue; }
         const asset = this._poolSvc.createAsset(file, size);
         if (asset) assets.push(asset);
      }
      if (!assets.length) return;

      this._ctx.set((prev) => ({ ...prev, pool: [...prev.pool, ...assets] }));

      if (directSlot !== null) {
         const sheet = this._sheet();
         const cellRatio = this._cellRatio(sheet);
         const fit = this._placeSvc.fitFor(assets[0].ratio, cellRatio, sheet.fitMode);
         this._commitSheet((s) => this._placeSvc.placeInSlot(s, directSlot, assets[0].id, fit));
         this.renderSheet();
         for (let i = 1; i < assets.length; i++) {
            const step = this._placeSvc.fillNextFree(assets[i], sheet, this._capacity(), cellRatio);
            if (step) await this._replay([step]);
         }
      } else {
         await this._fillFreeGradually(assets);
      }
      if (!this._watchHandle) this.renderAll();
   }

   removeFromPool(id) {
      this._ctx.set((prev) => ({
         ...prev,
         pool: this._poolSvc.removeAsset(prev.pool, id),
         sheets: this._placeSvc.removeAssetFromAllSheets(prev.sheets, id)
      }));
      if (!this._watchHandle) this.renderAll();
      if (this._pendingRefId === id) this._pendingRefId = null;
   }

   clearPlacements() {
      this._commitSheet((s) => this._placeSvc.clearPlacements(s));
      this._toasts?.show('Celdas vaciadas · las imágenes siguen en el pool', { type: 'info' });
   }

   removePlacement(slot) {
      this._commitSheet((s) => this._placeSvc.removePlacement(s, slot));
   }

   // ---------- colocación gradual ----------

   async _fillFreeGradually(refIds) {
      const sheet = this._sheet();
      const cellRatio = this._cellRatio(sheet);
      const assets = refIds
         .map((id) => this._asset(id))
         .filter(Boolean);

      const queue = this._placeSvc.fillGradually(assets, sheet, this._capacity(), cellRatio);
      await this._replay(queue);

      const out = assets.length - queue.length;
      if (out > 0) this._toasts?.show(`${out} imagen(es) esperan en el pool`, { type: 'info' });
   }

   _cellRatio(sheet) {
      const geo = this._cellGeometry(
         sheet,
         this._templates.get(sheet.templateId),
         this._templates.page(sheet.pageId),
         this._templates.preset(sheet.presetId)
      );
      return geo.cellRatio;
   }

   async _replay(queue) {
      if (this._placing) return;
      this._placing = true;
      for (const step of queue) {
         this._lastAnimatedSlot = step.slot;
         this._commitSheet((s) => this._placeSvc.placeInSlot(s, step.slot, step.refId, step.fit));
         await new Promise((r) => setTimeout(r, STEP_MS));
      }
      this._lastAnimatedSlot = -1;
      this.renderSheet();
      this._placing = false;
   }

   smartAssign(notify = false) {
      if (this._placing) return;
      const sheet = this._sheet();
      if (!this._state.pool.length) {
         this._toasts?.show('No hay imágenes en el pool todavía', { type: 'info' });
         return;
      }

      const cellRatio = this._cellRatio(sheet);
      const queue = this._placeSvc.smartAssign(
         this._state.pool, sheet, this._capacity(), cellRatio
      );

      this._commitSheet((s) => this._placeSvc.clearPlacements(s));
      this._replay(queue);

      if (notify) {
         const out = this._state.pool.length - queue.length;
         this._toasts?.show(out > 0
            ? `${queue.length} colocadas · ${out} en el pool sin lugar`
            : `${queue.length} imágenes acomodadas`, { type: 'info' });
      }
   }

   _setTemplate(t) {
      this._commitSheet((s) => {
         const cleaned = this._placeSvc.cleanupPlacement(s, t.cols * t.rows);
         return {
            ...cleaned,
            templateId: t.id,
            cols: Array(t.cols).fill(1),
            rows: Array(t.rows).fill(1)
         };
      });

      const waiting = this._state.pool.length - this._placeSvc.countUsedInSheet(this._sheet());
      if (waiting > 0) {
         this._toasts?.show(`${waiting} imagen(es) permanecen en la biblioteca`, { type: 'info' });
      }
   }

   assignToSlot(slot) {
      if (!this._pendingRefId) return;
      const refId = this._pendingRefId;
      const asset = this._asset(refId);
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
         const chip = document.createElement('div');
         chip.className = 'layoutssection__sheetchip' + (sh.id === s.activeId ? ' is-active' : '');

         const main = document.createElement('button');
         main.type = 'button';
         main.className = 'layoutssection__sheetchip-main';
         main.textContent = `Hoja ${i + 1}`;
         main.addEventListener('click', () => this._ctx.patch({ activeId: sh.id }));
         chip.appendChild(main);

         if (s.sheets.length > 1) {
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'layoutssection__sheetchip-del';
            del.textContent = '×';
            del.setAttribute('aria-label', `Eliminar Hoja ${i + 1}`);
            del.addEventListener('click', () => this.removeSheet(sh.id));
            chip.appendChild(del);
         }

         bar.appendChild(chip);
      });

      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'layoutssection__sheetchip-add';
      add.textContent = '+ Nueva hoja';
      add.addEventListener('click', () => this.addSheet());
      bar.appendChild(add);
   }

   addSheet() {
      const s = this._state;
      const current = this._sheet();
      const fresh = this._sheetSvc.createSheet(s.sheets.length + 1, current);

      this._ctx.set((prev) => ({
         activeId: fresh.id,
         sheets: [...prev.sheets, fresh]
      }));
      if (!this._watchHandle) this.renderAll();
      this._toasts?.show(`Hoja ${s.sheets.length} creada`, { type: 'success' });
   }

   removeSheet(id) {
      this._ctx.set((prev) => this._sheetSvc.removeSheet(prev.sheets, prev.activeId, id));
      if (!this._watchHandle) this.renderAll();
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
         const pct = Math.round((this._state.zoom ?? 0.7) * 100);
         this.$refs.zoomInfo.textContent = `Zoom ${pct}% · Ctrl+rueda`;
      }
   }

   renderGallery() {
      const host = this._panel?.getGalleryHost();
      if (!host) return;
      const s = this._state;
      host.hidden = s.pool.length === 0;
      host.replaceChildren();

      const header = document.createElement('span');
      header.className = 'layoutspanel__label';
      header.textContent = `Biblioteca (${s.pool.length})`;
      host.appendChild(header);

      const grid = document.createElement('div');
      grid.className = 'layoutspanel__gallery';

      const usedInActive = this._placeSvc.usedAssetIds(this._sheet());

      s.pool.forEach((asset) => {
         const wrap = document.createElement('div');
         wrap.className = 'layoutspanel__pool-item';

         const thumb = document.createElement('button');
         thumb.type = 'button';
         thumb.className = 'layoutspanel__thumb';
         if (this._pendingRefId === asset.id) thumb.classList.add('is-pending');
         thumb.style.backgroundImage = `url("${asset.url}")`;
         thumb.setAttribute('data-tooltip', usedInActive.has(asset.id)
            ? 'Arrastrar a una celda · click para recolocar'
            : 'Arrastrar a una celda · click para seleccionar');
         thumb.addEventListener('click', () => {
            this._pendingRefId = this._pendingRefId === asset.id ? null : asset.id;
            this.renderGallery();
         });

         this._dnd.makeDraggable(wrap, {
            handle: thumb,
            data: { type: 'pool-asset', assetId: asset.id },
            ghost: true,
            ghostClass: 'layoutspanel__pool-item--dragging',
            onDragEnd: () => { this._dropTargetSlot = null; }
         });

         const del = document.createElement('button');
         del.type = 'button';
         del.className = 'layoutspanel__pool-del';
         del.textContent = '×';
         del.setAttribute('aria-label', 'Eliminar del pool');
         del.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeFromPool(asset.id);
         });

         const dot = document.createElement('span');
         dot.className = 'layoutspanel__pool-dot';
         if (usedInActive.has(asset.id)) dot.classList.add('is-used');

         wrap.append(thumb, dot, del);
         grid.appendChild(wrap);
      });

      host.appendChild(grid);
   }

   renderSheet() {
      const seq = ++this._renderSeq;
      this._renderChain = this._renderChain.then(() => {
         if (seq !== this._renderSeq) return null;
         return this._renderSheetInto(this._sheet(), this.$refs.sheet, { interactive: true, seq });
      });
      return this._renderChain;
   }

   async _renderSheetInto(sheet, host, { interactive = false, seq = null } = {}) {
      const tpl = this._templates.get(sheet.templateId);
      const page = this._templates.page(sheet.pageId);
      const preset = this._templates.preset(sheet.presetId);
      const geo = this._cellGeometry(sheet, tpl, page, preset);

      const scale = PX_PER_MM;
      this._lastScale = scale;

      const W = Math.round(page.w * scale);
      const H = Math.round(page.h * scale);
      Object.assign(host.style, {
         width: `${W}px`,
         height: `${H}px`,
         padding: `${preset.marginMm * scale}px`,
         gap: `${preset.gapMm * scale}px`,
         gridTemplateColumns: geo.colWmm.map((w) => `${Math.round(w * scale)}px`).join(' '),
         gridTemplateRows: geo.rowHmm.map((h) => `${Math.round(h * scale)}px`).join(' '),
         transform: `scale(${this._state.zoom ?? 0.7})`,
         transformOrigin: 'top center'
      });

      if (interactive) slice.controller.destroyByContainer(host);
      host.replaceChildren();

      for (let idx = 0; idx < tpl.cols * tpl.rows; idx++) {
         const ref = sheet.placement[idx];
         const asset = ref ? this._asset(ref.refId) : null;
         const col = idx % tpl.cols;
         const row = Math.floor(idx / tpl.cols);
         const animate = interactive && idx === this._lastAnimatedSlot;

         if (!interactive) {
            const cell = document.createElement('div');
            cell.className = 'layoutssection__cell';
            if (asset && ref) {
               cell.classList.add('layoutssection__cell--img');
               cell.style.backgroundImage = `url("${asset.url}")`;
               const imgScale = sheet.imageScale ?? 1;
               if (imgScale < 1) {
                  cell.style.backgroundSize = `${imgScale * 100}%`;
                  cell.style.backgroundPosition = 'center';
                  cell.style.backgroundRepeat = 'no-repeat';
               } else {
                  cell.style.backgroundSize = ref.fit === 'contain' ? 'contain' : 'cover';
               }
            }
            host.appendChild(cell);
            continue;
         }

         const cell = await slice.build('SheetCell', {
            slot: idx,
            col,
            row,
            img: asset ? { ...asset, fit: ref?.fit || 'cover' } : null,
            imageScale: sheet.imageScale ?? 1,
            animate,
            onPick: (slotIdx) => this._onEmptyCellClick(slotIdx),
            onRemove: (slotIdx) => this.removePlacement(slotIdx),
            onMenu: (info) => this._showInfoMenu(info.nativeEvent, info),
            onEdgeDrag: (e, axis, k) => this._beginBoundaryDrag(e, axis, k)
         });
         if (seq !== null && seq !== this._renderSeq) {
            cell?.remove?.();
            return;
         }
         if (!cell) continue;

         cell.setGeometry(tpl.cols, tpl.rows);
         host.appendChild(cell);

         if (interactive) {
            const slotIdx = idx;

            if (ref) {
               this._dnd.makeDraggable(cell, {
                  handle: cell.querySelector('.sheetcell'),
                  data: { type: 'cell-swap', sourceSlot: slotIdx, assetId: ref.refId },
                  ghost: true,
                  threshold: 5
               });
            }

            this._dnd.makeDroppable(cell, {
               accept: (data) => data?.type === 'pool-asset' || data?.type === 'cell-swap',
               onDragEnter: () => cell.classList.add('sheetcell--drop-hover'),
               onDragLeave: () => cell.classList.remove('sheetcell--drop-hover'),
               onDrop: (_el, _ev, data) => {
                  cell.classList.remove('sheetcell--drop-hover');
                  this._handleCellDrop(slotIdx, data);
               }
            });
         }
      }

      if (interactive) {
         this._renderSplitters(host, geo, tpl, preset);
         this._tips?.scope(host);
         this._applyCellTooltips(host, geo);
      }
   }

   _applyCellTooltips(host, geo) {
      if (!this._tips) return;
      const cm = (mm) => `${(mm / 10).toFixed(1)} cm`;

      Array.from(host.querySelectorAll('slice-sheet-cell')).forEach((cellEl) => {
         const slot = Number(cellEl.querySelector('.sheetcell')?.dataset.slot ?? cellEl.dataset.slot);
         if (!Number.isFinite(slot)) return;
         const col = slot % geo.cols.length;
         const row = Math.floor(slot / geo.cols.length);
         const text = `${cm(geo.colWmm[col])} × ${cm(geo.rowHmm[row])}`;
         this._tips.detach(cellEl);
         this._tips.attach(cellEl, { text, placement: 'bottom', showDelay: 120 });
      });
   }

   // ---------- geometría ----------

   _cellGeometry(sheet, tpl, page, preset) {
      return this._geom.geometry(tpl, page, preset, sheet.cols, sheet.rows);
   }

   // ---------- splitters ----------

   _renderSplitters(host, geo, tpl, preset) {
      const scale = this._lastScale || PX_PER_MM;
      const innerLeft = preset.marginMm * scale;
      const innerTop = preset.marginMm * scale;
      const innerW = host.clientWidth - preset.marginMm * 2 * scale;
      const innerH = host.clientHeight - preset.marginMm * 2 * scale;
      const gapPx = preset.gapMm * scale;

      const makeHandle = (axis, k) => {
         const h = document.createElement('div');
         h.className = `layoutssection__splitter layoutssection__splitter--${axis}`;

         if (axis === 'v') {
            const left = innerLeft +
               geo.colWmm.slice(0, k).reduce((a, b) => a + b, 0) +
               gapPx * k - HOLD_DRAG_PX / 2;
            h.style.left = `${left}px`;
            h.style.top = `${innerTop}px`;
            h.style.height = `${innerH}px`;
            h.style.width = `${HOLD_DRAG_PX}px`;
         } else {
            const top = innerTop +
               geo.rowHmm.slice(0, k).reduce((a, b) => a + b, 0) +
               gapPx * k - HOLD_DRAG_PX / 2;
            h.style.top = `${top}px`;
            h.style.left = `${innerLeft}px`;
            h.style.width = `${innerW}px`;
            h.style.height = `${HOLD_DRAG_PX}px`;
         }
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
   }

   _beginBoundaryDrag(event, axis, k) {
      event.preventDefault();
      const sheet = this._sheet();
      const geo = this._cellGeometry(
         sheet,
         this._templates.get(sheet.templateId),
         this._templates.page(sheet.pageId),
         this._templates.preset(sheet.presetId)
      );

      const startPos = axis === 'v' ? event.clientX : event.clientY;
      const weights = axis === 'v' ? [...geo.cols] : [...geo.rows];

      const onMove = (ev) => {
         const zoom = this._state.zoom ?? 0.7;
         const effectiveScale = PX_PER_MM * zoom;
         const delta = ((axis === 'v' ? ev.clientX : ev.clientY) - startPos) / effectiveScale;
         const unit = axis === 'v'
            ? geo.colWmm[k - 1] / weights[k - 1]
            : geo.rowHmm[k - 1] / weights[k - 1];
         let wA = weights[k - 1] + delta / unit;
         let wB = weights[k] - delta / unit;
         const min = 0.15;
         if (wA < min) { wB += min - wA; wA = min; }
         if (wB < min) { wA += min - wB; wB = min; }
         weights[k - 1] = wA;
         weights[k] = wB;

         requestAnimationFrame(() => {
            this._commitSheet((s) => (axis === 'v'
               ? { ...s, cols: [...weights] }
               : { ...s, rows: [...weights] }));
         });
      };

      const onUp = () => {
         window.removeEventListener('pointermove', onMove);
         window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
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
            label: 'Quitar de la celda',
            icon: 'trash-2',
            danger: true,
            action: () => this.removePlacement(info.slot)
         });
         items.push({
            label: 'Eliminar del pool',
            icon: 'trash-2',
            danger: true,
            action: () => this.removeFromPool(img.id)
         });
      }

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
               this.renderAll();
            }
         });
      });
   }

   _onEmptyCellClick(slot) {
      if (this._pendingRefId) {
         this.assignToSlot(slot);
         this.renderGallery();
         this.renderSheet();
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
         const cellRatio = this._cellRatio(sheet);
         const fit = this._placeSvc.fitFor(asset.ratio, cellRatio, sheet.fitMode);
         this._commitSheet((s) => this._placeSvc.placeInSlot(s, targetSlot, asset.id, fit));
         this.renderSheet();
         this.renderGallery();
         return;
      }

      if (data.type === 'cell-swap') {
         const sourceSlot = data.sourceSlot;
         if (sourceSlot === targetSlot) return;
         const sourceRef = sheet.placement[sourceSlot];
         const targetRef = sheet.placement[targetSlot];
         this._commitSheet((s) => {
            const newPlacement = { ...s.placement };
            if (sourceRef && targetRef) {
               newPlacement[targetSlot] = sourceRef;
               newPlacement[sourceSlot] = targetRef;
            } else if (sourceRef) {
               newPlacement[targetSlot] = sourceRef;
               delete newPlacement[sourceSlot];
            }
            return { ...s, placement: newPlacement };
         });
         this.renderSheet();
      }
   }

   // ---------- exportación ----------

   async exportPNGs() {
      const stages = await this._exportSvc.renderOffscreen(
         this._state.sheets,
         (sheet, tmp) => this._renderSheetInto(sheet, tmp, { interactive: false })
      );
      try {
         const count = await this._exportSvc.exportPNGs(stages, html2canvas);
         this._toasts?.show(`${count} hoja(s) exportadas como PNG`, { type: 'success' });
      } catch {
         this._toasts?.show('Error al exportar PNGs', { type: 'error' });
      } finally {
         this._exportSvc.cleanupStages(stages);
      }
   }

   async exportPDF() {
      const stages = await this._exportSvc.renderOffscreen(
         this._state.sheets,
         (sheet, tmp) => this._renderSheetInto(sheet, tmp, { interactive: false })
      );
      try {
         const ok = await this._exportSvc.exportPDF(stages, html2canvas, jsPDF);
         if (ok) {
            this._toasts?.show('PDF generado con todas las hojas', { type: 'success' });
         }
      } catch {
         this._toasts?.show('Error al generar el PDF', { type: 'error' });
      } finally {
         this._exportSvc.cleanupStages(stages);
      }
   }

   printSheet() {
      this._exportSvc.printSheet(this.$refs.sheet);
   }
}

customElements.define('slice-layouts-section', LayoutsSection);
