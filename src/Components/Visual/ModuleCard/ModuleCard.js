export default class ModuleCard extends HTMLElement {

   static props = {
      title: { type: 'string', default: '' },
      description: { type: 'string', default: '' },
      icon: { type: 'string', default: 'sparkles' },
      features: { type: 'array', default: [] },
      path: { type: 'string', default: null },
      actionLabel: { type: 'string', default: 'Abrir' },
      index: { type: 'number', default: 0 },
      revealDelay: { type: 'number', default: 0 },
      // Color propio de la card: pinta el icono, la cinta y la sombra dura.
      accent: { type: 'string', default: 'var(--primary-color)' },
      accentInk: { type: 'string', default: 'var(--primary-color-contrast)' }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$root = this.querySelector('.modulecard');
      this.$index = this.querySelector('.modulecard__index');
      this.$icon = this.querySelector('.modulecard__icon');
      this.$title = this.querySelector('.modulecard__title');
      this.$description = this.querySelector('.modulecard__description');
      this.$features = this.querySelector('.modulecard__features');
      this.$action = this.querySelector('.modulecard__action');

      // La card entera es el objetivo de click; el botón interno no vuelve a
      // disparar open() para no navegar dos veces.
      this.$root.addEventListener('click', () => this.open());
      this.$root.addEventListener('keydown', (e) => {
         if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.open();
         }
      });

      slice.controller.setComponentProps(this, props);
   }

   async init() {
      this.$root.setAttribute('role', 'link');
      this.$root.setAttribute(
         'aria-label',
         `${this._title} — ${this._actionLabel.toLowerCase()}`
      );

      const icon = await slice.build('Icon', {
         name: this._icon,
         size: 22,
         color: 'currentColor'
      });
      if (icon) this.$icon.appendChild(icon);

      const button = await slice.build('Button', {
         value: this._actionLabel,
         icon: { name: 'arrow-right' },
         variant: 'ghost',
         size: 'sm',
         // El click burbujea hasta $root, que ya navega. Evitamos el doble
         // navigate marcando el evento como manejado.
         onClick: () => {}
      });
      if (button) {
         button.setAttribute('tabindex', '-1');
         button.setAttribute('aria-hidden', 'true');
         this.$action.appendChild(button);
      }
   }

   beforeDestroy() {
      slice.controller.destroyByContainer(this);
   }

   open() {
      if (!this._path) return;
      slice.router.navigate(this._path);
   }

   _renderFeatures() {
      if (!this.$features) return;
      this.$features.replaceChildren();
      for (const feature of this._features) {
         const item = document.createElement('li');
         item.className = 'modulecard__feature';
         item.textContent = feature;
         this.$features.appendChild(item);
      }
   }

   get title() { return this._title; }
   set title(value) {
      this._title = value || '';
      if (this.$title) this.$title.textContent = this._title;
   }

   get description() { return this._description; }
   set description(value) {
      this._description = value || '';
      if (this.$description) this.$description.textContent = this._description;
   }

   get icon() { return this._icon; }
   set icon(value) {
      this._icon = value || 'sparkles';
   }

   get features() { return this._features; }
   set features(value) {
      this._features = Array.isArray(value) ? value : [];
      this._renderFeatures();
   }

   get path() { return this._path; }
   set path(value) {
      this._path = value || null;
   }

   get actionLabel() { return this._actionLabel; }
   set actionLabel(value) {
      this._actionLabel = value || 'Abrir';
   }

   get index() { return this._index; }
   set index(value) {
      this._index = Number(value) || 0;
      if (this.$index) {
         this.$index.textContent = this._index
            ? String(this._index).padStart(2, '0')
            : '';
      }
   }

   get revealDelay() { return this._revealDelay; }
   set revealDelay(value) {
      this._revealDelay = Number(value) || 0;
      this.style.setProperty('--d', `${this._revealDelay}ms`);
   }

   get accent() { return this._accent; }
   set accent(value) {
      this._accent = value || 'var(--primary-color)';
      this.style.setProperty('--card-accent', this._accent);
   }

   get accentInk() { return this._accentInk; }
   set accentInk(value) {
      this._accentInk = value || 'var(--primary-color-contrast)';
      this.style.setProperty('--card-ink', this._accentInk);
   }

}

customElements.define('slice-module-card', ModuleCard);
