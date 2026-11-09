// Modal singleton de la app: medidas exactas (cm) de una celda de hoja.
// Patrón conclave: se construye lazy sobre <slice-modal> con sliceId fijo,
// guard por promesa en vuelo (GOTCHAS §17) y recuperación vía
// slice.getComponent('cell-size-modal').
export default class CellSizeModal extends HTMLElement {

   constructor(props) {
      super();
      slice.attachTemplate(this);
      this._built = false;
      this._buildPromise = null;
      this._onApply = null;
      this._ctxInfo = null;

      slice.controller.setComponentProps(this, props || {});
   }

   /** Garantiza el <slice-modal> interno. Idempotente y a prueba de carreras. */
   ensure() {
      if (!this._buildPromise) this._buildPromise = this._build();
      return this._buildPromise;
   }

   async _build() {
      const modal = await slice.build('Modal', {
         title: 'Medidas de la celda',
         width: '320px',
         dismissable: true
      });
      if (!modal) throw new Error('No se pudo construir Modal');

      const body = document.createElement('div');
      body.className = 'csm__body';

      this.$info = document.createElement('p');
      this.$info.className = 'csm__info';
      body.appendChild(this.$info);

      const hint = document.createElement('p');
      hint.className = 'csm__hint';
      hint.textContent = 'Por defecto, el ancho se aplica a toda la columna y el alto a toda la fila.';
      body.appendChild(hint);

      const options = document.createElement('div');
      options.className = 'csm__options';
      this.$all = this._mkOption(options, 'Aplicar a todas las celdas');
      this.$lock = this._mkOption(options, 'Mantener proporción');
      body.appendChild(options);

      this.$wInput = this._mkField(body, 'Ancho de columna (cm)', '9.0');
      this.$hInput = this._mkField(body, 'Alto de fila (cm)', '12.7');

      // Con la proporción bloqueada, editar un eje actualiza el otro.
      this.$wInput.addEventListener('input', () => this._syncAspect('w'));
      this.$hInput.addEventListener('input', () => this._syncAspect('h'));

      this._modal = modal;
      modal.appendBody(body);

      // Footer: Cancelar + Aplicar
      const row = document.createElement('div');
      row.className = 'csm__footer';

      const cancel = await slice.build('Button', {
         value: 'Cancelar', variant: 'outlined', size: 'sm',
         onClick: () => this.close()
      });
      const apply = await slice.build('Button', {
         value: 'Aplicar', icon: { name: 'check' }, size: 'sm',
         onClick: () => this._apply()
      });
      if (cancel) row.appendChild(cancel);
      if (apply) row.appendChild(apply);

      modal.appendFooter(row);

      this.appendChild(modal);
      this._built = true;
   }

   _mkField(parent, labelText, value) {
      const labelEl = document.createElement('label');
      labelEl.className = 'csm__field';
      const span = document.createElement('span');
      span.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.1';
      input.min = '1.5';
      input.max = '40';
      input.value = value;
      input.addEventListener('keydown', (ev) => {
         ev.stopPropagation();
         if (ev.key === 'Enter') this._apply();
      });
      labelEl.append(span, input);
      parent.appendChild(labelEl);
      return input;
   }

   _mkOption(parent, labelText) {
      const labelEl = document.createElement('label');
      labelEl.className = 'csm__option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      const span = document.createElement('span');
      span.textContent = labelText;
      labelEl.append(input, span);
      parent.appendChild(labelEl);
      return input;
   }

   _syncAspect(axis) {
      if (!this.$lock?.checked || !(this._ratio > 0)) return;

      const w = parseFloat(this.$wInput.value);
      const h = parseFloat(this.$hInput.value);
      if (axis === 'w' && Number.isFinite(w) && w > 0) {
         this.$hInput.value = (w / this._ratio).toFixed(1);
      } else if (axis === 'h' && Number.isFinite(h) && h > 0) {
         this.$wInput.value = (h * this._ratio).toFixed(1);
      }
   }

   /**
    * @param {Object} opts
    * @param {{pxW:number,pxH:number,name?:string,fit?:string}|null} opts.img
    * @param {number} opts.cellWmm  ancho actual de la celda en mm
    * @param {number} opts.cellHmm  alto actual de la celda en mm
    * @param {(wcm:number|null, hcm:number|null, options?:{applyAll:boolean}) => void} opts.onApply
    *   Recibe `null` en el eje que el usuario no modificó. Con `applyAll` se
    *   aplican las dos medidas a todas las columnas y filas.
    */
   open(opts = {}) {
      this.ensure().then(() => {
         this._onApply = typeof opts.onApply === 'function' ? opts.onApply : null;
         this._ratio = opts.cellHmm > 0 ? opts.cellWmm / opts.cellHmm : 1;
         this.$all.checked = false;
         this.$lock.checked = false;

         const cm = (mm) => `${(mm / 10).toFixed(1)}`;
         this.$info.innerHTML =
           `<strong>Celda</strong> ${cm(opts.cellWmm)} × ${cm(opts.cellHmm)} cm` +
           (opts.img
             ? `<br><strong>Imagen</strong> ${opts.img.pxW} × ${opts.img.pxH} px` +
               `<br><strong>A 300dpi</strong> ${cm((opts.img.pxW / 300) * 2.54 * 10)} × ${cm((opts.img.pxH / 300) * 2.54 * 10)} cm` +
               `<br><strong>Ajuste</strong> ${opts.img.fit === 'contain' ? 'contener' : 'cubrir'}` +
               (opts.img.name ? `<br><em>${this._escapeHtml(opts.img.name)}</em>` : '')
             : '');

         // Valor mostrado al abrir: sirve para distinguir qué campo tocó el
         // usuario. Aplicar solo el eje editado evita que abrir el modal y
         // tocar el ancho convierta también el alto en medida exacta.
         const shownW = (opts.cellWmm / 10).toFixed(1);
         const shownH = (opts.cellHmm / 10).toFixed(1);
         this._shown = { w: parseFloat(shownW), h: parseFloat(shownH) };
         this.$wInput.value = shownW;
         this.$hInput.value = shownH;

         requestAnimationFrame(() => { this._modal.open = true; });
      });
   }

   _apply() {
      const wcm = parseFloat(this.$wInput.value);
      const hcm = parseFloat(this.$hInput.value);

      // Uniforme: se envían ambos valores aunque no hayan cambiado, porque el
      // objetivo es que todas las columnas/filas queden iguales.
      if (this.$all?.checked) {
         this._modal?.close();
         this._onApply?.(
            Number.isFinite(wcm) ? wcm : null,
            Number.isFinite(hcm) ? hcm : null,
            { applyAll: true }
         );
         return;
      }

      const shown = this._shown || { w: NaN, h: NaN };
      // `null` = el usuario no tocó ese campo: la hoja conserva ese eje como
      // estaba (con pesos o con su medida exacta previa).
      const w = Number.isFinite(wcm) && wcm !== shown.w ? wcm : null;
      const h = Number.isFinite(hcm) && hcm !== shown.h ? hcm : null;
      this._modal?.close();
      this._onApply?.(w, h, { applyAll: false });
   }

   close() {
      this._modal?.close();
   }

   _escapeHtml(text) {
      return String(text ?? '')
         .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
         .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
   }
}

customElements.define('slice-cell-size-modal', CellSizeModal);
