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

      this.$wInput = this._mkField(body, 'Ancho cm', '9.0');
      this.$hInput = this._mkField(body, 'Alto cm', '12.7');

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

   /**
    * @param {Object} opts
    * @param {{pxW:number,pxH:number,name?:string,fit?:string}|null} opts.img
    * @param {number} opts.cellWmm  ancho actual de la celda en mm
    * @param {number} opts.cellHmm  alto actual de la celda en mm
    * @param {(wcm:number, hcm:number) => void} opts.onApply
    */
   open(opts = {}) {
      this.ensure().then(() => {
         this._onApply = typeof opts.onApply === 'function' ? opts.onApply : null;

         const cm = (mm) => `${(mm / 10).toFixed(1)}`;
         this.$info.innerHTML =
           `<strong>Celda</strong> ${cm(opts.cellWmm)} × ${cm(opts.cellHmm)} cm` +
           (opts.img
             ? `<br><strong>Imagen</strong> ${opts.img.pxW} × ${opts.img.pxH} px` +
               `<br><strong>A 300dpi</strong> ${cm((opts.img.pxW / 300) * 2.54 * 10)} × ${cm((opts.img.pxH / 300) * 2.54 * 10)} cm` +
               `<br><strong>Ajuste</strong> ${opts.img.fit === 'contain' ? 'contener' : 'cubrir'}` +
               (opts.img.name ? `<br><em>${this._escapeHtml(opts.img.name)}</em>` : '')
             : '');

         this.$wInput.value = (opts.cellWmm / 10).toFixed(1);
         this.$hInput.value = (opts.cellHmm / 10).toFixed(1);

         requestAnimationFrame(() => { this._modal.open = true; });
      });
   }

   _apply() {
      const wcm = parseFloat(this.$wInput.value);
      const hcm = parseFloat(this.$hInput.value);
      this._modal?.close();
      this._onApply?.(wcm, hcm);
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
