const _sliceDeprecated = new Set();
function deprecate(oldName, newName) {
   if (_sliceDeprecated.has(oldName)) return;
   _sliceDeprecated.add(oldName);
   console.warn(`[Slice] "${oldName}" is deprecated; use "${newName}" instead.`);
}

export default class Select extends HTMLElement {

   static props = {
      options: {
         type: 'array',
         default: [],
         required: false
      },
      disabled: {
         type: 'boolean',
         default: false
      },
      label: {
         type: 'string',
         default: '',
         required: false
      },
      multiple: {
         type: 'boolean',
         default: false
      },
      visibleProp: {
         type: 'string',
         default: 'text',
         required: false
      },
      // Type to filter the options.
      searchable: {
         type: 'boolean',
         default: false
      },
      // Show a button to clear the current selection.
      clearable: {
         type: 'boolean',
         default: false
      },
      placeholder: {
         type: 'string',
         default: '',
         required: false
      },
      // Canonical change handler. `onOptionSelect` is kept as a deprecated alias.
      onChange: {
         type: 'function',
         default: null
      },
      onOptionSelect: {
         type: 'function',
         default: null
      }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);
      this.$dropdown = this.querySelector('.slice_select_dropdown');
      this.$selectContainer = this.querySelector('.slice_select_container');
      this.$label = this.querySelector('.slice_select_label');
      this.$select = this.querySelector('.slice_select');
      this.$menu = this.querySelector('.slice_select_menu');
      this.$caret = this.querySelector('.caret');
      this.$clear = this.querySelector('.slice_select_clear');

      this.$selectContainer.setAttribute('role', 'button');
      this.$selectContainer.setAttribute('tabindex', '0');
      this.$selectContainer.setAttribute('aria-haspopup', 'listbox');
      this.$selectContainer.setAttribute('aria-expanded', 'false');
      this.$menu.setAttribute('role', 'listbox');
      this.$select.readOnly = true;

      this._value = [];
      this._optionEls = [];
      this._highlightEl = null;
      this._search = '';
      this._searchable = false;
      this._clearable = false;
      this._placeholder = '';

      this._onContainerClick = this._onContainerClick.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
      this._onSearchInput = this._onSearchInput.bind(this);
      this._onClear = this._onClear.bind(this);
      this._onOutsideClick = (event) => {
         if (!this.contains(event.target)) this._setOpen(false);
      };

      this.$selectContainer.addEventListener('click', this._onContainerClick);
      this.$selectContainer.addEventListener('keydown', this._onKeyDown);
      this.$select.addEventListener('input', this._onSearchInput);
      if (this.$clear) this.$clear.addEventListener('click', this._onClear);
      // Close on outside click instead of a hover-only `mouseleave`, which never
      // fired on touch devices and left the menu stuck open after a tap.
      document.addEventListener('click', this._onOutsideClick);

      slice.controller.setComponentProps(this, props);
   }

   init() {
      // Static props ensure all properties have default values
   }

   beforeDestroy() {
      document.removeEventListener('click', this._onOutsideClick);
   }

   _isOpen() {
      return this.$menu.classList.contains('menu_open');
   }

   _setOpen(open) {
      this.$menu.classList.toggle('menu_open', open);
      this.$caret.classList.toggle('caret_open', open);
      this.$selectContainer.setAttribute('aria-expanded', open ? 'true' : 'false');
      this._clearHighlight();

      if (open && this._searchable) {
         this._search = '';
         this._applyFilter();
         this.$select.readOnly = false;
         this.$select.value = '';
         this.$select.placeholder = this._value.length
            ? this._value.map((o) => o[this.visibleProp]).join(', ')
            : this._placeholder;
         this.$select.focus();
      } else if (!open) {
         if (this._searchable) {
            this.$select.readOnly = true;
            this._search = '';
            this._applyFilter();
         }
         this.updateSelectLabel();
      }
   }

   // --- interaction handlers ---
   _onContainerClick(event) {
      if (this._disabled) return;
      if (this.$clear && this.$clear.contains(event.target)) return;
      // While searching, clicking the input keeps the menu open for typing.
      if (this._searchable && this._isOpen() && event.target === this.$select) return;
      this._setOpen(!this._isOpen());
   }

   _onKeyDown(event) {
      if (this._disabled) return;
      const open = this._isOpen();
      switch (event.key) {
         case 'ArrowDown':
            event.preventDefault();
            if (!open) this._setOpen(true);
            else this._moveHighlight(1);
            break;
         case 'ArrowUp':
            if (open) { event.preventDefault(); this._moveHighlight(-1); }
            break;
         case 'Enter':
            event.preventDefault();
            if (open && this._highlightEl) this._selectHighlighted();
            else this._setOpen(!open);
            break;
         case ' ':
            // Let the space reach the input while typing a search.
            if (!(this._searchable && open)) { event.preventDefault(); this._setOpen(!open); }
            break;
         case 'Escape':
            if (open) { event.preventDefault(); this._setOpen(false); }
            break;
         case 'Home':
            if (open) { event.preventDefault(); this._highlightEdge(0); }
            break;
         case 'End':
            if (open) { event.preventDefault(); this._highlightEdge(-1); }
            break;
      }
   }

   _onSearchInput() {
      if (!this._searchable || !this._isOpen()) return;
      this._search = this.$select.value.toLowerCase();
      this._applyFilter();
      this._clearHighlight();
   }

   _onClear(event) {
      event.stopPropagation();
      if (this._disabled) return;
      this._value = [];
      this.$menu.querySelectorAll('.active').forEach((el) => {
         el.classList.remove('active');
         el.setAttribute('aria-selected', 'false');
      });
      this.updateSelectLabel();
      if (this._onChange) this._onChange.call(this);
   }

   // --- filtering & highlight (keyboard nav) ---
   _applyFilter() {
      let anyVisible = false;
      for (const { el, option } of this._optionEls) {
         const text = String(option[this.visibleProp] ?? '').toLowerCase();
         const match = !this._search || text.includes(this._search);
         el.style.display = match ? '' : 'none';
         if (match) anyVisible = true;
      }
      if (this.$noResults) this.$noResults.style.display = anyVisible ? 'none' : '';
   }

   _visibleEls() {
      return this._optionEls.filter((o) => o.el.style.display !== 'none').map((o) => o.el);
   }

   _clearHighlight() {
      if (this._highlightEl) {
         this._highlightEl.classList.remove('highlighted');
         this._highlightEl = null;
      }
   }

   _setHighlightEl(el) {
      this._clearHighlight();
      if (el) {
         el.classList.add('highlighted');
         el.scrollIntoView({ block: 'nearest' });
         this._highlightEl = el;
      }
   }

   _moveHighlight(delta) {
      const visible = this._visibleEls();
      if (!visible.length) return;
      let index = this._highlightEl ? visible.indexOf(this._highlightEl) : -1;
      index += delta;
      if (index < 0) index = 0;
      if (index >= visible.length) index = visible.length - 1;
      this._setHighlightEl(visible[index]);
   }

   _highlightEdge(position) {
      const visible = this._visibleEls();
      if (!visible.length) return;
      this._setHighlightEl(position === 0 ? visible[0] : visible[visible.length - 1]);
   }

   _selectHighlighted() {
      const entry = this._optionEls.find((o) => o.el === this._highlightEl);
      if (entry) this._selectOption(entry.option, entry.el);
   }

   // Selection logic shared by click and keyboard.
   async _selectOption(option, optEl) {
      const previousActive = this.$menu.querySelector('.active');
      if (previousActive && !this.multiple) {
         previousActive.classList.remove('active');
         previousActive.setAttribute('aria-selected', 'false');
      }

      if (this._value.length === 1 && !this.multiple) {
         this.removeOptionFromValue(this._value[0]);
         this.addSelectedOption(option);
         optEl.classList.add('active');
         optEl.setAttribute('aria-selected', 'true');
         if (this._onChange) await this._onChange.call(this);
         return;
      }

      if (this.isObjectInArray(option, this._value).found) {
         this.removeOptionFromValue(option);
         optEl.classList.remove('active');
         optEl.setAttribute('aria-selected', 'false');
      } else {
         this.addSelectedOption(option);
         optEl.classList.add('active');
         optEl.setAttribute('aria-selected', 'true');
      }
      if (this._onChange) await this._onChange.call(this);
   }

   get options() {
      return this._options;
   }

   set options(values) {
      if (!values || !Array.isArray(values)) return;

      this._options = values;
      this._optionEls = [];
      this._highlightEl = null;

      if (!this.$menu) return;
      this.$menu.innerHTML = '';

      values.forEach((option) => {
         const opt = document.createElement('div');
         opt.textContent = option[this.visibleProp];
         opt.setAttribute('role', 'option');
         opt.setAttribute('aria-selected', 'false');
         opt.addEventListener('click', () => this._selectOption(option, opt));
         this.$menu.appendChild(opt);
         this._optionEls.push({ el: opt, option });
      });

      // "No results" placeholder for searchable filtering (role=presentation so
      // it is never counted as an option).
      this.$noResults = document.createElement('div');
      this.$noResults.className = 'slice_select_no_results';
      this.$noResults.setAttribute('role', 'presentation');
      this.$noResults.textContent = 'No results';
      this.$noResults.style.display = 'none';
      this.$menu.appendChild(this.$noResults);

      this._applyFilter();
   }

   removeOptionFromValue(option) {
      const optionIndex = this.isObjectInArray(option, this._value).index;
      if (optionIndex !== -1) {
         this._value.splice(optionIndex, 1);
         this.updateSelectLabel();
      }

      if (this._value.length === 0) {
         this.$label.classList.remove('slice_select_value');
      }
   }

   updateSelectLabel() {
      this.$select.value = '';

      if (this._value.length > 0) {
         this.$select.value = this._value.map((option) => option[this.visibleProp]).join(', ');
         this.$label.classList.add('slice_select_value');
      } else {
         this.$label.classList.remove('slice_select_value');
      }
      this._updateClearVisibility();
   }

   _updateClearVisibility() {
      if (this.$clear) {
         this.$clear.style.display = this._clearable && this._value.length > 0 ? '' : 'none';
      }
   }

   addSelectedOption(option) {
      this._value.push(option);
      this.updateSelectLabel();
      this.$label.classList.add('slice_select_value');
      if (!this.multiple) {
         this._setOpen(false);
      }
   }

   get value() {
      if (this._value.length === 1) {
         return this._value[0];
      }
      return this._value;
   }

   set value(valueParam) {
      if (!valueParam || !Array.isArray(valueParam)) return;

      this._value = [];

      if (valueParam.length > 1 && !this.multiple) {
         console.error('Select is not multiple, you can only select one option');
         return;
      }

      if (!this._options) {
         console.error('Cannot set value before options are defined');
         return;
      }

      const validOptions = valueParam.every((option) =>
         this.isObjectInArray(option, this._options).found
      );

      if (!validOptions) {
         console.error('Error: At least one of the provided options is not in this.options');
         return;
      }

      this.$label.classList.add('slice_select_value');
      valueParam.forEach((option) => this.addSelectedOption(option));
   }

   get label() {
      return this._label;
   }

   set label(value) {
      this._label = value;
      if (value !== null && value !== undefined && this.$label) {
         this.$label.textContent = value;
      }
   }

   get multiple() {
      return this._multiple;
   }

   set multiple(value) {
      this._multiple = value;
   }

   get searchable() {
      return this._searchable;
   }

   set searchable(value) {
      this._searchable = value === true;
      if (this.$select) {
         // The input is pointer-events:none by default (display only); enable it
         // so the user can focus and type when the select is searchable.
         this.$select.style.pointerEvents = this._searchable ? 'auto' : '';
         if (!this._searchable) this.$select.readOnly = true;
      }
   }

   get clearable() {
      return this._clearable;
   }

   set clearable(value) {
      this._clearable = value === true;
      this._updateClearVisibility();
   }

   get placeholder() {
      return this._placeholder;
   }

   set placeholder(value) {
      this._placeholder = typeof value === 'string' ? value : '';
   }

   get disabled() {
      return this._disabled;
   }

   set disabled(value) {
      this._disabled = value;
      if (this.$selectContainer) {
         if (value) {
            this.$selectContainer.style.opacity = '0.5';
            this.$selectContainer.style.cursor = 'not-allowed';
         } else {
            this.$selectContainer.style.opacity = '1';
            this.$selectContainer.style.cursor = 'pointer';
         }
      }
   }

   get visibleProp() {
      return this._visibleProp;
   }

   set visibleProp(value) {
      this._visibleProp = value;
      // Regenerate the option divs if options were already set.
      if (this._options && this._options.length > 0) {
         this.options = this._options;
      }
   }

   get onChange() {
      return this._onChange;
   }

   set onChange(value) {
      if (typeof value === 'function') this._onChange = value;
   }

   // Deprecated alias for onChange.
   get onOptionSelect() {
      return this._onChange;
   }

   set onOptionSelect(value) {
      if (typeof value === 'function') {
         this._onChange ??= value;
         deprecate('onOptionSelect', 'onChange');
      }
   }

   isObjectInArray(objeto, arreglo) {
      for (let i = 0; i < arreglo.length; i++) {
         if (this.sameObject(arreglo[i], objeto)) {
            return { found: true, index: i };
         }
      }
      return { found: false, index: -1 };
   }

   sameObject(objetoA, objetoB) {
      const keysA = Object.keys(objetoA);
      const keysB = Object.keys(objetoB);

      if (keysA.length !== keysB.length) {
         return false;
      }

      for (const key of keysA) {
         const valueA = objetoA[key];
         const valueB = objetoB[key];

         if (typeof valueA === 'object' && typeof valueB === 'object') {
            if (!this.sameObject(valueA, valueB)) {
               return false;
            }
         } else if (valueA !== valueB) {
            return false;
         }
      }

      return true;
   }
}

customElements.define('slice-select', Select);
