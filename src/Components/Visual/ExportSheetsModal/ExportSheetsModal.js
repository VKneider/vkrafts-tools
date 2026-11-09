// Modal singleton para exportar un subconjunto de hojas.
// Sigue el patrón de CellSizeModal: se construye una vez sobre <slice-modal>,
// con guard por promesa en vuelo y recuperación vía slice.getComponent().
export default class ExportSheetsModal extends HTMLElement {

   constructor(props) {
      super();
      slice.attachTemplate(this);
      this._built = false;
      this._buildPromise = null;
      this._onExport = null;
      this._sheets = [];
      this._activeId = null;

      slice.controller.setComponentProps(this, props || {});
   }

   ensure() {
      if (!this._buildPromise) this._buildPromise = this._build();
      return this._buildPromise;
   }

   async _build() {
      const modal = await slice.build('Modal', {
         title: 'Exportar hojas',
         width: '440px',
         dismissable: true
      });
      if (!modal) throw new Error('No se pudo construir Modal');

      const body = document.createElement('div');
      body.className = 'exsm__body';

      this.$summary = document.createElement('p');
      this.$summary.className = 'exsm__summary';
      body.appendChild(this.$summary);

      this.$list = document.createElement('div');
      this.$list.className = 'exsm__list';
      body.appendChild(this.$list);

      const tools = document.createElement('div');
      tools.className = 'exsm__tools';

      this.$all = document.createElement('button');
      this.$all.type = 'button';
      this.$all.className = 'exsm__tool';
      this.$all.textContent = 'Todas';
      this.$all.addEventListener('click', () => this._setAll(true));

      this.$none = document.createElement('button');
      this.$none.type = 'button';
      this.$none.className = 'exsm__tool';
      this.$none.textContent = 'Ninguna';
      this.$none.addEventListener('click', () => this._setAll(false));

      tools.append(this.$all, this.$none);
      body.appendChild(tools);

      modal.appendBody(body);

      const footer = document.createElement('div');
      footer.className = 'exsm__footer';

      const cancel = await slice.build('Button', {
         value: 'Cancelar', variant: 'outlined', size: 'sm',
         onClick: () => this.close()
      });
      const pdf = await slice.build('Button', {
         value: 'PDF', icon: { name: 'download' }, variant: 'outlined', size: 'sm',
         onClick: () => this._submit('pdf')
      });
      const png = await slice.build('Button', {
         value: 'PNGs', icon: { name: 'image' }, variant: 'outlined', size: 'sm',
         onClick: () => this._submit('png')
      });
      const print = await slice.build('Button', {
         value: 'Imprimir', icon: { name: 'printer' }, variant: 'soft', size: 'sm',
         onClick: () => this._submit('print')
      });

      [cancel, pdf, png, print].filter(Boolean).forEach((b) => footer.appendChild(b));
      modal.appendFooter(footer);

      this._modal = modal;
      this.appendChild(modal);
      this._built = true;
   }

   /**
    * @param {Object} opts
    * @param {{id:string,label:string,used:number,capacity:number}[]} opts.sheets
    * @param {string|null} [opts.activeId]
    * @param {(payload:{sheetIds:string[],format:'pdf'|'png'|'print'}) => void} opts.onExport
    */
   open(opts = {}) {
      this.ensure().then(() => {
         this._sheets = Array.isArray(opts.sheets) ? opts.sheets : [];
         this._activeId = opts.activeId ?? null;
         this._onExport = typeof opts.onExport === 'function' ? opts.onExport : null;

         this._renderList();
         requestAnimationFrame(() => { this._modal.open = true; });
      });
   }

   _renderList() {
      this.$list.replaceChildren();

      this._sheets.forEach((sheet) => {
         const row = document.createElement('label');
         row.className = 'exsm__row' + (sheet.used > 0 ? '' : ' is-empty');

         const input = document.createElement('input');
         input.type = 'checkbox';
         input.dataset.sheetId = sheet.id;
         input.checked = sheet.used > 0;
         input.disabled = sheet.used === 0;
         input.addEventListener('change', () => this._updateSummary());

         const name = document.createElement('span');
         name.className = 'exsm__name';
         name.textContent = sheet.label;

         const count = document.createElement('small');
         count.className = 'exsm__count';
         count.textContent = sheet.used > 0
            ? `${sheet.used}/${sheet.capacity}`
            : 'vacía';

         row.append(input, name, count);
         this.$list.appendChild(row);
      });

      this._updateSummary();
   }

   _setAll(checked) {
      this.$list.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach((input) => {
         input.checked = checked;
      });
      this._updateSummary();
   }

   _selectedIds() {
      return [...this.$list.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)')]
         .map((input) => input.dataset.sheetId);
   }

   _updateSummary() {
      const total = this._sheets.filter((sheet) => sheet.used > 0).length;
      const selected = this._selectedIds().length;

      this.$summary.classList.toggle('is-warning', total > 0 && selected === 0);
      this.$summary.textContent = total
         ? `${selected} de ${total} hoja(s) con contenido`
         : 'No hay hojas con contenido para exportar.';
   }

   _submit(format) {
      const sheetIds = this._selectedIds();
      if (!sheetIds.length) {
         this._updateSummary();
         this.$summary.textContent = 'Elegí al menos una hoja con contenido.';
         this.$summary.classList.add('is-warning');
         return;
      }

      this._modal?.close();
      this._onExport?.({ sheetIds, format });
   }

   close() {
      this._modal?.close();
   }
}

customElements.define('slice-export-sheets-modal', ExportSheetsModal);
