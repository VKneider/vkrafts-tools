export default class DropZone extends HTMLElement {

   static props = {
      title: { type: 'string', default: 'Arrastra tus imágenes aquí' },
      hint: { type: 'string', default: 'o haz click para elegirlas · PNG, JPG, WEBP' },
      onFiles: { type: 'function', default: null }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$input = this.querySelector('.dropzone__input');
      this.$body = this.querySelector('[data-drop-body]');
      this.$icon = this.querySelector('.dropzone__icon');
      this.$titleEl = this.querySelector('.dropzone__title');
      this.$hintEl = this.querySelector('.dropzone__hint');

      slice.controller.setComponentProps(this, props);
   }

   async init() {
      const tips = slice.getComponent('ToolTipProvider');

      // `image` (singular) es el nombre válido del Icon; `images` no existe y
      // renderizaba un <svg> vacío sin avisar.
      const icon = await slice.build('Icon', { name: 'image', size: 30, color: 'currentColor' });
      if (icon) this.$icon.appendChild(icon);

      if (tips) {
         tips.attach(this.$body, { text: 'También puedes pegar imágenes con Ctrl+V dentro del módulo', placement: 'bottom' });
      }

      this.$body.addEventListener('click', () => this.$input.click());

      this.$input.addEventListener('change', () => {
         this._emitFiles(Array.from(this.$input.files || []));
         this.$input.value = '';
      });

      ['dragenter', 'dragover'].forEach((evt) => {
         this.$body.addEventListener(evt, (e) => {
            e.preventDefault();
            this.classList.add('dropzone--over');
         });
      });
      ['dragleave', 'drop'].forEach((evt) => {
         this.$body.addEventListener(evt, (e) => {
            e.preventDefault();
            this.classList.remove('dropzone--over');
         });
      });
      this.$body.addEventListener('drop', (e) => {
         const files = Array.from(e.dataTransfer?.files || [])
            .filter((f) => f.type.startsWith('image/'));
         this._emitFiles(files);
      });
   }

   beforeDestroy() {
      const tips = slice.getComponent('ToolTipProvider');
      if (tips) tips.detach(this.$body);
   }

   _emitFiles(files) {
      if (!files.length) return;
      // Props down: callback directa (y evento como compat).
      this._onFiles?.(files);
      this.dispatchEvent(new CustomEvent('files', { detail: { files }, bubbles: true }));
   }

   get onFiles() { return this._onFiles; }
   set onFiles(fn) { this._onFiles = typeof fn === 'function' ? fn : null; }

   get title() { return this._title; }
   set title(value) {
      this._title = value ?? '';
      if (this.$titleEl) this.$titleEl.textContent = this._title;
   }

   get hint() { return this._hint; }
   set hint(value) {
      this._hint = value ?? '';
      if (this.$hintEl) this.$hintEl.textContent = this._hint;
   }
}

customElements.define('slice-drop-zone', DropZone);
