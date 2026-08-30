// Warns once per deprecated prop name (kept module-scoped so each component
// reports a given alias only once per session).
const _sliceDeprecated = new Set();
function deprecate(oldName, newName) {
   if (_sliceDeprecated.has(oldName)) return;
   _sliceDeprecated.add(oldName);
   console.warn(`[Slice] "${oldName}" is deprecated; use "${newName}" instead.`);
}

export default class Button extends HTMLElement {

   static props = {
      value: {
         type: 'string',
         default: 'Button',
         required: false
      },
      // Visual style, all derived from theme tokens. `filled` preserves the
      // original solid look.
      variant: {
         type: 'string',
         default: 'filled',
         required: false,
         allowedValues: ['filled', 'outlined', 'ghost', 'soft', 'danger']
      },
      // Size variant. `sm` gives compact dimensions for toolbars/dense UIs.
      // (Improvement ported from the conclave project.)
      size: {
         type: 'string',
         default: 'md',
         required: false,
         allowedValues: ['md', 'sm']
      },
      // Canonical click handler. `onClickCallback` is kept as a deprecated alias.
      onClick: {
         type: 'function',
         default: null
      },
      onClickCallback: {
         type: 'function',
         default: null
      },
      customColor: {
         type: 'object',
         default: null
      },
      icon: {
         type: 'object',
         default: null
      },
      disabled: {
         type: 'boolean',
         default: false
      }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);
      this.$value = this.querySelector('.slice_button_value');
      this.$button = this.querySelector('.slice_button');
      this.$container = this.querySelector('.slice_button_container');

      // type="button" prevents accidental form submission when used inside a form.
      this.$button.setAttribute('type', 'button');

      // Listener is attached unconditionally; the handler is resolved at click
      // time so it works whether it arrived via onClick or the legacy alias.
      this.$container.addEventListener('click', async () => {
         if (this._disabled) return;
         if (this._onClick) await this._onClick();
      });

      slice.controller.setComponentProps(this, props);
   }

   async init() {
      await this.update();   // build the Icon child if `icon` is set
   }

   // Reconcile the Icon child with the current `icon` prop, in place. The setter
   // updates an existing icon; building or removing one is async, so it lives here.
   // After changing `icon` post-build, call update() to apply the structural change.
   async update() {
      if (this._icon && !this.$icon) {
         this.$icon = await slice.build('Icon', {
            name: this._icon.name,
            size: this._icon.size || '16',
            iconStyle: this._icon.iconStyle,
            color: this._icon.color || 'currentColor',
         });
         this.$button.insertBefore(this.$icon, this.$value);
      } else if (!this._icon && this.$icon) {
         slice.controller.destroyComponent(this.$icon);
         this.$icon = null;
      }
   }

   get onClick() {
      return this._onClick;
   }

   set onClick(value) {
      // Accept null/non-function to CLEAR the handler — needed to permanently
      // disable a button (the click listener lives on the wrapper container, so
      // the stale handler would otherwise keep firing).
      this._onClick = typeof value === 'function' ? value : null;
   }

   // Deprecated alias for onClick.
   set onClickCallback(value) {
      if (typeof value === 'function') {
         this._onClick ??= value;
         deprecate('onClickCallback', 'onClick');
      }
   }

   get icon() {
      return this._icon;
   }

   set icon(value) {
      this._icon = value;
      if (!this.$icon || !value) return;   // appear/disappear handled in update()
      this.$icon.name = value.name;
      if (value.color) this.$icon.color = value.color;
      if (value.size) this.$icon.size = value.size;
   }

   get variant() {
      return this._variant;
   }

   set variant(value) {
      const allowed = ['filled', 'outlined', 'ghost', 'soft', 'danger'];
      const next = allowed.includes(value) ? value : 'filled';
      if (this._variant) {
         this.$button.classList.remove('slice_button--' + this._variant);
      }
      this._variant = next;
      this.$button.classList.add('slice_button--' + next);
   }

   get size() {
      return this._size;
   }

   set size(value) {
      const allowed = ['md', 'sm'];
      const next = allowed.includes(value) ? value : 'md';
      if (this._size && this._size !== 'md') {
         this.$button.classList.remove('slice_button--' + this._size);
      }
      this._size = next;
      if (next === 'sm') this.$button.classList.add('slice_button--sm');
   }

   get value() {
      return this._value;
   }

   set value(value) {
      this._value = value;
      this.$value.textContent = value;
      // Keep an accessible name even for icon-only buttons.
      if (value) this.$button.setAttribute('aria-label', value);
   }

   get customColor() {
      return this._customColor;
   }

   get disabled() {
      return this._disabled;
   }

   set disabled(value) {
      this._disabled = !!value;
      if (this._disabled) {
         this.$button.classList.add('slice_button--disabled');
         this.$button.setAttribute('aria-disabled', 'true');
      } else {
         this.$button.classList.remove('slice_button--disabled');
         this.$button.removeAttribute('aria-disabled');
      }
   }

   // Canonical shape: { background, text }. Legacy { button, label } still works.
   set customColor(value) {
      this._customColor = value;
      if (!value) return;

      if (value.button || value.label) {
         deprecate('customColor { button, label }', 'customColor { background, text }');
      }

      const background = value.background ?? value.button;
      const text = value.text ?? value.label;

      if (background) {
         this.$button.style.backgroundColor = background;
         this.$button.style.borderColor = background;
      }
      if (text) {
         this.$button.style.color = text;
         this.$value.style.color = text;
         if (this.$icon) {
            this.$icon.style.color = text;
         }
      }
   }
}

customElements.define('slice-button', Button);
