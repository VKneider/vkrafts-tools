export default class DropDown extends HTMLElement {

   static props = {
      label: { 
         type: 'string', 
         default: '', 
         required: false 
      },
      options: { 
         type: 'array', 
         default: [], 
         required: false 
      }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$dropdown = this.querySelector('.slice_dropdown');
      this.$box = this.querySelector('.slice_dropbox');
      this.$label = this.querySelector('.slice_dropdown_label');
      this.$caret = this.querySelector('.caret');

      this.$dropdown.setAttribute('role', 'button');
      this.$dropdown.setAttribute('tabindex', '0');
      this.$dropdown.setAttribute('aria-haspopup', 'true');
      this.$dropdown.setAttribute('aria-expanded', 'false');

      this.$dropdown.addEventListener('click', (event) => {
         event.stopPropagation();
         this.toggleDrop();
      });
      this.$dropdown.addEventListener('keydown', (event) => {
         if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this.toggleDrop();
         } else if (event.key === 'Escape') {
            this.closeDrop();
         }
      });

      // Closing is handled by re-toggling the trigger, picking an option, or the
      // outside-click listener wired in init(). A `mouseleave` auto-close was
      // removed: it fired a synthetic close on touch taps and also closed the box
      // the instant the pointer crossed the gap from the trigger to the options.

      slice.controller.setComponentProps(this, props);
   }

   init() {
      this._outsideClickListener = (event) => {
         if (!this.contains(event.target)) {
            this.closeDrop();
         }
      };

      document.addEventListener('click', this._outsideClickListener);
   }

   beforeDestroy() {
      if (this._outsideClickListener) {
         document.removeEventListener('click', this._outsideClickListener);
      }
   }

   get label() {
      return this._label;
   }

   set label(value) {
      this._label = value;
      this.$label.textContent = value;
   }

   get options() {
      return this._options;
   }

   set options(values) {
      this._options = Array.isArray(values) ? values : [];
      this.$box.innerHTML = '';

      this._options.forEach((element) => {
         const div = document.createElement('div');
         const e = document.createElement('a');

         const text = element?.text || element?.label || '';
         const href = element?.href || element?.path || '#';

         e.addEventListener('click', async (event) => {
            if (element?.path && slice?.router?.navigate) {
               event.preventDefault();
               await slice.router.navigate(element.path);
            }
            this.closeDrop();
         });
         e.textContent = text;
         e.href = href;
         div.appendChild(e);
         this.$box.appendChild(div);
      });
   }

   toggleDrop() {
      const open = this.$box.classList.toggle('slice_dropbox_open');
      this.$caret.classList.toggle('caret_open');
      this.$dropdown.setAttribute('aria-expanded', open ? 'true' : 'false');
   }
   closeDrop() {
      this.$box.classList.remove('slice_dropbox_open');
      this.$caret.classList.remove('caret_open');
      this.$dropdown.setAttribute('aria-expanded', 'false');
   }
}

customElements.define('slice-dropdown', DropDown);
