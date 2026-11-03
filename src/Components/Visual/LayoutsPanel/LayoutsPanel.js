export default class LayoutsPanel extends HTMLElement {

   static props = {
      sheet: { type: 'object', default: null },
      templates: { type: 'object', default: null },
      onPageChange: { type: 'function', default: null },
      onTemplateChange: { type: 'function', default: null },
      onPresetChange: { type: 'function', default: null },
      onFitChange: { type: 'function', default: null },
      onScaleChange: { type: 'function', default: null },
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
      }
      if (sheet.productId !== prevProps?.sheet?.productId) {
         this._highlightProduct(sheet);
      }
      if (sheet.presetId !== prevProps?.sheet?.presetId) {
         this._highlightPreset(sheet.presetId);
      }
      if (sheet.fitMode !== prevProps?.sheet?.fitMode) {
         this._highlightFit(sheet.fitMode);
      }
      if ((sheet.imageScale ?? 1) !== (prevProps?.sheet?.imageScale ?? 1)) {
         this._updateScale(sheet.imageScale);
      }
   }

   async _buildControls() {
      const { sheet, templates } = this;
      if (!sheet || !templates) return;

      const dropzone = await slice.build('DropZone', {
         onFiles: (files) => this._onFiles?.(files)
      });
      if (dropzone) this.$refs.drop.appendChild(dropzone);

      if (this.actions?.length) {
         for (const d of this.actions) {
            const btn = await slice.build('Button', {
               value: d.label, icon: { name: d.icon }, variant: d.variant, size: 'sm',
               onClick: d.handler
            });
            if (btn) {
               btn.setAttribute('data-tooltip', d.tip);
               btn.setAttribute('data-tooltip-placement', 'bottom');
               this.$refs.actions.appendChild(btn);
            }
         }
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
         pageSelect.value = [pageOptions.find((o) => o.id === sheet.pageId)];
         this.$refs.page.appendChild(pageSelect);
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

      for (const p of templates.presets) {
         const btn = document.createElement('button');
         btn.type = 'button';
         btn.className = 'layoutspanel__chip';
         btn.dataset.presetId = p.id;
         btn.setAttribute('data-tooltip', `Margen ${p.marginMm}mm · separación ${p.gapMm}mm`);
         btn.textContent = p.name;
         btn.addEventListener('click', () => this._onPresetChange?.(p.id));
         this.$refs.preset.appendChild(btn);
      }

      const fits = [
         { id: 'smart', label: 'Smart', icon: 'wand-magic-sparkles', tip: 'Recorta si el encuadre es parecido; respeta proporciones si no' },
         { id: 'cover', label: 'Cubrir', icon: 'grid', tip: 'Llena la celda recortando lo que sobre' },
         { id: 'contain', label: 'Contener', icon: 'image', tip: 'Imagen completa dentro de la celda' }
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
      scaleSlider.addEventListener('input', () => {
         const val = parseFloat(scaleSlider.value);
         scaleLabel.textContent = `${Math.round(val * 100)}%`;
         this._onScaleChange?.(val);
      });
      this.$refs.scale.appendChild(scaleSlider);
      this.$refs.scale.appendChild(scaleLabel);

      this._$scaleSlider = scaleSlider;
      this._$scaleLabel = scaleLabel;

      this._built = true;

      this._highlightTemplate(sheet.templateId);
      this._highlightPreset(sheet.presetId);
      this._highlightFit(sheet.fitMode);
      this._highlightProduct(sheet);
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

   get onPresetChange() { return this._onPresetChange; }
   set onPresetChange(fn) { this._onPresetChange = typeof fn === 'function' ? fn : null; }

   get onFitChange() { return this._onFitChange; }
   set onFitChange(fn) { this._onFitChange = typeof fn === 'function' ? fn : null; }

   get onScaleChange() { return this._onScaleChange; }
   set onScaleChange(fn) { this._onScaleChange = typeof fn === 'function' ? fn : null; }

   get onProductChange() { return this._onProductChange; }
   set onProductChange(fn) { this._onProductChange = typeof fn === 'function' ? fn : null; }

   get onFiles() { return this._onFiles; }
   set onFiles(fn) { this._onFiles = typeof fn === 'function' ? fn : null; }

   get actions() { return this._actions; }
   set actions(v) { this._actions = Array.isArray(v) ? v : []; }
}

customElements.define('slice-layouts-panel', LayoutsPanel);