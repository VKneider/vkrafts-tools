export default class LayoutsPanel extends HTMLElement {

   static props = {
      sheet: { type: 'object', default: null },
      templates: { type: 'object', default: null },
      onPageChange: { type: 'function', default: null },
      onTemplateChange: { type: 'function', default: null },
      onCustomGrid: { type: 'function', default: null },
      onPresetChange: { type: 'function', default: null },
      onCustomPreset: { type: 'function', default: null },
      onFitChange: { type: 'function', default: null },
      onScaleStart: { type: 'function', default: null },
      onScaleChange: { type: 'function', default: null },
      cropEnabled: { type: 'boolean', default: false },
      cropZoom: { type: 'number', default: 1 },
      cropCount: { type: 'number', default: 0 },
      onCropZoomChange: { type: 'function', default: null },
      onProductChange: { type: 'function', default: null },
      onFiles: { type: 'function', default: null },
      actions: { type: 'array', default: [] }
   };

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
      await this._buildControls();
   }

   update(prevProps) {
      const sheet = this.sheet;
      if (!sheet || !this._built) return;

      if (sheet.templateId !== prevProps?.sheet?.templateId) {
         this._highlightTemplate(sheet.templateId);
         this._syncCustomGrid(sheet);
      }
      if (sheet.pageId !== prevProps?.sheet?.pageId) {
         this._refreshPageOptions(sheet);
      }
      if (sheet.productId !== prevProps?.sheet?.productId) {
         this._highlightProduct(sheet);
      }
      if (sheet.presetId !== prevProps?.sheet?.presetId) {
         this._highlightPreset(sheet.presetId);
         this._syncCustomMargins(sheet);
      }
      if (sheet.fitMode !== prevProps?.sheet?.fitMode) {
         this._highlightFit(sheet.fitMode);
      }
      if ((sheet.imageScale ?? 1) !== (prevProps?.sheet?.imageScale ?? 1)) {
         this._updateScale(sheet.imageScale);
      }
      this._syncCropControls();
   }

   async _buildControls() {
      const { sheet, templates } = this;
      if (!sheet || !templates) return;

      const dropzone = await slice.build('DropZone', {
         onFiles: (files) => this._onFiles?.(files)
      });
      if (dropzone) this.$refs.drop.appendChild(dropzone);

      if (this.actions?.length) {
         const primaryRow = document.createElement('div');
         primaryRow.className = 'layoutspanel__actions-row layoutspanel__actions-row--primary';
         primaryRow.setAttribute('role', 'group');
         primaryRow.setAttribute('aria-label', 'Acciones de la hoja');
         const exportRow = document.createElement('div');
         exportRow.className = 'layoutspanel__actions-row layoutspanel__actions-row--export';
         exportRow.setAttribute('role', 'group');
         exportRow.setAttribute('aria-label', 'Exportar');

         for (const d of this.actions) {
            const btn = await slice.build('Button', {
               value: d.label, icon: { name: d.icon }, variant: d.variant, size: 'sm',
               onClick: d.handler
            });
            if (!btn) continue;
            btn.setAttribute('data-tooltip', d.tip);
            btn.setAttribute('data-tooltip-placement', 'bottom');
            btn.dataset.actionKey = d.key;
            (d.group === 'export' ? exportRow : primaryRow).appendChild(btn);
         }

         if (primaryRow.children.length) this.$refs.actions.appendChild(primaryRow);
         if (exportRow.children.length) this.$refs.actions.appendChild(exportRow);
      }

      const pageOptions = templates.pages().map((p) => ({ ...p, text: p.label }));
      const pageSelect = await slice.build('Select', {
         options: pageOptions, visibleProp: 'text', placeholder: 'Tamaño de hoja',
         onChange: () => {
            const v = pageSelect.value;
            if (!Array.isArray(v)) this._onPageChange?.(v.id);
         }
      });
      if (pageSelect) {
         this.$refs.page.appendChild(pageSelect);
         this._pageSelect = pageSelect;
         this._refreshPageOptions(sheet);
      }

      for (const p of templates.allProducts()) {
         const btn = document.createElement('button');
         btn.type = 'button';
         btn.className = 'layoutspanel__chip layoutspanel__product';
         btn.dataset.productId = p.id;
         btn.textContent = p.name;
         btn.setAttribute('data-tooltip', `Celdas de ${p.wMm}×${p.hMm} mm a tamaño real`);
         btn.addEventListener('click', () => this._onProductChange?.(p));
         this.$refs.product.appendChild(btn);
      }

      // Las plantillas derivadas de un producto (grid-4x5) no van al selector:
      // se generan solas y ensuciarían la lista fija.
      for (const t of templates.all().filter((x) => !x.derived)) {
         const btn = document.createElement('button');
         btn.type = 'button';
         btn.className = 'layoutspanel__tpl-mini';
         btn.dataset.templateId = t.id;
         btn.setAttribute('data-tooltip', `${t.name} · ${t.cols}×${t.rows}`);

         const mini = document.createElement('span');
         mini.className = 'layoutspanel__tpl-sheet';
         mini.style.aspectRatio = '1 / 1.35';
         mini.style.gridTemplateColumns = `repeat(${t.cols}, 1fr)`;
         mini.style.gridTemplateRows = `repeat(${t.rows}, 1fr)`;
         for (let i = 0; i < t.cols * t.rows; i++) {
            mini.appendChild(document.createElement('i'));
         }
         const labelEl = document.createElement('span');
         labelEl.className = 'layoutspanel__tpl-name';
         labelEl.textContent = t.name;

         btn.append(mini, labelEl);
         btn.addEventListener('click', () => this._onTemplateChange?.(t));
         this.$refs.tplPicker.appendChild(btn);
      }

      // Los presets personalizados viven en el catálogo para la geometría, pero
      // no ensucian la lista fija de chips.
      for (const p of templates.presets.filter((x) => !x.derived)) {
         const btn = document.createElement('button');
         btn.type = 'button';
         btn.className = 'layoutspanel__chip';
         btn.dataset.presetId = p.id;
         btn.setAttribute('data-tooltip', `Margen ${p.marginMm}mm · separación ${p.gapMm}mm`);
         btn.textContent = p.name;
         btn.addEventListener('click', () => this._onPresetChange?.(p.id));
         this.$refs.preset.appendChild(btn);
      }

      this._bindCustomGrid();
      this._bindCustomMargins();

      const fits = [
         { id: 'smart', label: 'Smart', icon: 'star', tip: 'Recorta si el encuadre es parecido; respeta proporciones si no' },
         { id: 'cover', label: 'Cubrir', icon: 'image', tip: 'Llena la celda recortando lo que sobre' },
         { id: 'contain', label: 'Contener', icon: 'align-center', tip: 'Imagen completa dentro de la celda' }
      ];
      for (const f of fits) {
         const btn = await slice.build('Button', {
            value: f.label, icon: { name: f.icon }, variant: 'ghost', size: 'sm',
            onClick: () => this._onFitChange?.(f.id)
         });
         btn.dataset.fit = f.id;
         btn.setAttribute('data-tooltip', f.tip);
         btn.setAttribute('data-tooltip-placement', 'bottom');
         this.$refs.fit.appendChild(btn);
      }

      const scaleSlider = document.createElement('input');
      scaleSlider.type = 'range';
      scaleSlider.min = '0.1';
      scaleSlider.max = '1';
      scaleSlider.step = '0.05';
      scaleSlider.value = String(sheet.imageScale ?? 1);
      scaleSlider.className = 'layoutspanel__scale-slider';
      const scaleLabel = document.createElement('span');
      scaleLabel.className = 'layoutspanel__scale-label';
      scaleLabel.textContent = `${Math.round((sheet.imageScale ?? 1) * 100)}%`;

      // Un solo snapshot de historial por gesto, no uno por cada `input`.
      scaleSlider.addEventListener('pointerdown', () => this._onScaleStart?.());
      scaleSlider.addEventListener('keydown', (e) => {
         const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
         if (keys.includes(e.key)) this._onScaleStart?.();
      });

      scaleSlider.addEventListener('input', () => {
         const val = parseFloat(scaleSlider.value);
         scaleLabel.textContent = `${Math.round(val * 100)}%`;
         this._onScaleChange?.(val);
      });
      this.$refs.scale.appendChild(scaleSlider);
      this.$refs.scale.appendChild(scaleLabel);

      this._$scaleSlider = scaleSlider;
      this._$scaleLabel = scaleLabel;

      // Zoom per-imagen: vive en el panel, no encima de la celda, para no
      // interferir con el drag & drop ni con el pan.
      const cropSlider = await slice.build('Slider', {
         min: 1,
         max: 3,
         step: 0.05,
         value: this.cropZoom ?? 1,
         size: 'sm',
         variant: 'plain',
         showValue: true,
         formatValue: (value) => `${Math.round(value * 100)}%`,
         onInput: (value) => this._onCropZoomChange?.(value)
      });
      if (cropSlider) {
         cropSlider.classList.add('layoutspanel__crop-slider');
         this.$refs.crop.appendChild(cropSlider);
         this._$cropSlider = cropSlider;
      }

      const cropReset = document.createElement('button');
      cropReset.type = 'button';
      cropReset.className = 'layoutspanel__crop-reset';
      cropReset.textContent = '100%';
      cropReset.title = 'Restablecer zoom de la imagen';
      cropReset.setAttribute('aria-label', 'Restablecer zoom de la imagen');
      cropReset.addEventListener('click', () => this._onCropZoomChange?.(1));
      this.$refs.crop.appendChild(cropReset);
      this._$cropReset = cropReset;

      this._built = true;

      this._syncCropControls();
      this._highlightTemplate(sheet.templateId);
      this._highlightPreset(sheet.presetId);
      this._highlightFit(sheet.fitMode);
      this._highlightProduct(sheet);
   }

   _bindCustomGrid() {
      const apply = () => {
         const cols = this._clampInt(this.$refs.customCols?.value, 1, 12);
         const rows = this._clampInt(this.$refs.customRows?.value, 1, 12);
         this._onCustomGrid?.(cols, rows);
      };

      this.$refs.customGridApply?.addEventListener('click', apply);
      [this.$refs.customCols, this.$refs.customRows].forEach((input) => {
         input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
               e.preventDefault();
               apply();
            }
         });
      });

      this._syncCustomGrid(this.sheet);
   }

   _syncCustomGrid(sheet) {
      if (!sheet || !this.$refs.customCols) return;
      const tpl = this.templates.get(sheet.templateId);
      this.$refs.customCols.value = String(tpl.cols);
      this.$refs.customRows.value = String(tpl.rows);
      if (this.$refs.customGridHint) {
         this.$refs.customGridHint.textContent = tpl.derived
            ? `Grilla activa: ${tpl.cols} × ${tpl.rows}`
            : 'Fija filas y columnas; reemplaza la plantilla activa.';
      }
   }

   _bindCustomMargins() {
      const apply = () => {
         const marginCm = this._clampNumber(this.$refs.customMargin?.value, 0, 5);
         const gapCm = this._clampNumber(this.$refs.customGap?.value, 0, 5);
         this._onCustomPreset?.({
            marginMm: marginCm * 10,
            gapMm: gapCm * 10
         });
      };

      this.$refs.customMarginsApply?.addEventListener('click', apply);
      [this.$refs.customMargin, this.$refs.customGap].forEach((input) => {
         input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
               e.preventDefault();
               apply();
            }
         });
      });

      this._syncCustomMargins(this.sheet);
   }

   _syncCustomMargins(sheet) {
      if (!sheet || !this.$refs.customMargin) return;
      const preset = this.templates.preset(sheet.presetId);
      this.$refs.customMargin.value = (preset.marginMm / 10).toFixed(1);
      this.$refs.customGap.value = (preset.gapMm / 10).toFixed(1);
   }

   _clampInt(value, min, max) {
      const n = Math.round(Number(value));
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
   }

   _clampNumber(value, min, max) {
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
   }

   _refreshPageOptions(sheet) {
      if (!this._pageSelect || !sheet) return;

      const options = this.templates.pages().map((p) => ({ ...p, text: p.label }));
      this._pageSelect.options = options;

      const current = options.find((o) => o.id === sheet.pageId)
         || options.find((o) => o.id === 'a4');
      if (current) this._pageSelect.value = [current];
   }

   _highlightProduct(sheet) {
      const activeId = sheet?.productId || null;
      this.$refs.product.querySelectorAll('.layoutspanel__product').forEach((b) => {
         b.classList.toggle('is-active', b.dataset.productId === activeId);
      });

      if (!this.$refs.productHint) return;
      if (activeId && sheet.cellSizeMm) {
         const { w, h } = sheet.cellSizeMm;
         this.$refs.productHint.textContent =
            `Celdas fijas de ${w}×${h} mm · el resto de la hoja queda libre`;
         this.$refs.productHint.hidden = false;
      } else {
         this.$refs.productHint.textContent = '';
         this.$refs.productHint.hidden = true;
      }
   }

   _highlightTemplate(id) {
      this.$refs.tplPicker.querySelectorAll('.layoutspanel__tpl-mini').forEach((b) => {
         b.classList.toggle('is-active', b.dataset.templateId === id);
      });
   }

   _highlightPreset(id) {
      this.$refs.preset.querySelectorAll('.layoutspanel__chip').forEach((b) => {
         b.classList.toggle('is-active', b.dataset.presetId === id);
      });
   }

   _highlightFit(id) {
      this.$refs.fit.querySelectorAll('[data-fit]').forEach((b) => {
         b.classList.toggle('layoutspanel__fit--on', b.dataset.fit === id);
      });
   }

   _updateScale(val) {
      if (this._$scaleSlider) this._$scaleSlider.value = String(val ?? 1);
      if (this._$scaleLabel) this._$scaleLabel.textContent = `${Math.round((val ?? 1) * 100)}%`;
   }

   _syncCropControls() {
      const enabled = this.cropEnabled === true;
      const value = Number.isFinite(this.cropZoom) ? this.cropZoom : 1;

      if (this._$cropSlider) {
         this._$cropSlider.disabled = !enabled;
         if (Math.abs(this._$cropSlider.value - value) > 0.001) {
            this._$cropSlider.value = value;
         }
      }
      if (this._$cropReset) this._$cropReset.disabled = !enabled;

      const hint = this.$refs.cropHint;
      if (hint) {
         const count = this.cropCount ?? 0;
         const text = !enabled
            ? 'Seleccioná una celda con imagen'
            : (count > 1
               ? `Se aplica a ${count} celdas · Alt+arrastrar para encuadrar`
               : 'Alt+arrastrar para encuadrar · doble clic para resetear');
         hint.textContent = text;
         hint.hidden = !text;
      }
      this.$refs.crop?.classList.toggle('is-disabled', !enabled);
   }

   getGalleryHost() {
      return this.$refs.gallery;
   }

   /** Bloquea las acciones mientras hay una exportación en curso. */
   setBusy(on) {
      this.classList.toggle('is-busy', !!on);
      this.$refs.actions?.querySelectorAll('slice-button, button').forEach((el) => {
         if ('disabled' in el) el.disabled = !!on;
         el.setAttribute('aria-disabled', String(!!on));
      });
   }

   get sheet() { return this._sheet; }
   set sheet(v) { this._sheet = v; }

   get templates() { return this._templates; }
   set templates(v) { this._templates = v; }

   get onPageChange() { return this._onPageChange; }
   set onPageChange(fn) { this._onPageChange = typeof fn === 'function' ? fn : null; }

   get onTemplateChange() { return this._onTemplateChange; }
   set onTemplateChange(fn) { this._onTemplateChange = typeof fn === 'function' ? fn : null; }

   get onCustomGrid() { return this._onCustomGrid; }
   set onCustomGrid(fn) { this._onCustomGrid = typeof fn === 'function' ? fn : null; }

   get onPresetChange() { return this._onPresetChange; }
   set onPresetChange(fn) { this._onPresetChange = typeof fn === 'function' ? fn : null; }

   get onCustomPreset() { return this._onCustomPreset; }
   set onCustomPreset(fn) { this._onCustomPreset = typeof fn === 'function' ? fn : null; }

   get onFitChange() { return this._onFitChange; }
   set onFitChange(fn) { this._onFitChange = typeof fn === 'function' ? fn : null; }

   get onScaleStart() { return this._onScaleStart; }
   set onScaleStart(fn) { this._onScaleStart = typeof fn === 'function' ? fn : null; }

   get onScaleChange() { return this._onScaleChange; }
   set onScaleChange(fn) { this._onScaleChange = typeof fn === 'function' ? fn : null; }

   get cropEnabled() { return this._cropEnabled; }
   set cropEnabled(v) { this._cropEnabled = !!v; }

   get cropZoom() { return this._cropZoom; }
   set cropZoom(v) { this._cropZoom = Number.isFinite(Number(v)) ? Number(v) : 1; }

   get cropCount() { return this._cropCount; }
   set cropCount(v) { this._cropCount = Number.isFinite(Number(v)) ? Number(v) : 0; }

   get onCropZoomChange() { return this._onCropZoomChange; }
   set onCropZoomChange(fn) { this._onCropZoomChange = typeof fn === 'function' ? fn : null; }

   get onProductChange() { return this._onProductChange; }
   set onProductChange(fn) { this._onProductChange = typeof fn === 'function' ? fn : null; }

   get onFiles() { return this._onFiles; }
   set onFiles(fn) { this._onFiles = typeof fn === 'function' ? fn : null; }

   get actions() { return this._actions; }
   set actions(v) { this._actions = Array.isArray(v) ? v : []; }
}

customElements.define('slice-layouts-panel', LayoutsPanel);