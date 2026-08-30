export default class Grid extends HTMLElement {

   static props = {
      columns: { 
         type: 'number', 
         default: 1, 
         required: false 
      },
      rows: { 
         type: 'number', 
         default: 1, 
         required: false 
      },
      items: { 
         type: 'array', 
         default: [], 
         required: false 
      },
      gap: {
         type: 'string',
         default: '10px',
         required: false
      },
      columnTemplate: {
         type: 'string',
         default: null,
         required: false
      },
      rowTemplate: {
         type: 'string',
         default: null,
         required: false
      }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$grid = this.querySelector('.grid-container');

      slice.controller.setComponentProps(this, props);
   }

   async init() {
      // Static props ensure columns and rows have default values
      // Apply gap if provided
      if (this.gap) {
         this.$grid.style.gap = this.gap;
      }
   }

   set columns(value) {
      this._columns = value;
      // Si hay un template personalizado, usarlo; sino usar repeat
      if (!this.columnTemplate) {
         this.$grid.style.gridTemplateColumns = `repeat(${value}, 1fr)`;
      }
   }

   get columns() {
      return this._columns;
   }

   set rows(value) {
      this._rows = value;
      // Si hay un template personalizado, usarlo; sino usar repeat
      if (!this.rowTemplate) {
         this.$grid.style.gridTemplateRows = `repeat(${value}, 1fr)`;
      }
   }

   get rows() {
      return this._rows;
   }

   set gap(value) {
      this._gap = value;
      if (this.$grid) {
         this.$grid.style.gap = value;
      }
   }

   get gap() {
      return this._gap;
   }

   set columnTemplate(value) {
      this._columnTemplate = value;
      if (value && this.$grid) {
         this.$grid.style.gridTemplateColumns = value;
      }
   }

   get columnTemplate() {
      return this._columnTemplate;
   }

   set rowTemplate(value) {
      this._rowTemplate = value;
      if (value && this.$grid) {
         this.$grid.style.gridTemplateRows = value;
      }
   }

   get rowTemplate() {
      return this._rowTemplate;
   }

   set items(values) {
      this.setItems(values);
      this._items = values;
   }

   get items() {
      return this._items;
   }

   async setItem(item) {
      if (!item || !item.classList) {
         console.warn('Grid: Invalid item provided to setItem', item);
         return;
      }
      item.classList.add('grid-item');
      this.$grid.appendChild(item);
   }

   async setItems(items) {
      if (!items || !Array.isArray(items)) {
         console.warn('Grid: Invalid items array provided', items);
         return;
      }
      for (let i = 0; i < items.length; i++) {
         await this.setItem(items[i]);
      }
   }

   // Método para limpiar el grid
   clear() {
      if (this.$grid) {
         this.$grid.innerHTML = '';
      }
   }
}

customElements.define('slice-grid', Grid);