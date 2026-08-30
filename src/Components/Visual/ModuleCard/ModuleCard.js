export default class ModuleCard extends HTMLElement {

   static props = {
      title: { type: 'string', default: '' },
      description: { type: 'string', default: '' },
      icon: { type: 'string', default: 'sparkles' },
      features: { type: 'array', default: [] },
      path: { type: 'string', default: null },
      actionLabel: { type: 'string', default: 'Abrir' }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);
      this.$root = this.querySelector('.modulecard');
      this.$icon = this.querySelector('.modulecard__icon');
      this.$title = this.querySelector('.modulecard__title');
      this.$description = this.querySelector('.modulecard__description');
      this.$features = this.querySelector('.modulecard__features');
      this.$action = this.querySelector('.modulecard__action');
      slice.controller.setComponentProps(this, props);
   }

   async init() {
      const icon = await slice.build('Icon', {
         name: this._icon,
         size: 28,
         color: 'currentColor'
      });
      if (icon) this.$icon.appendChild(icon);

      const button = await slice.build('Button', {
         value: this._actionLabel,
         icon: { name: 'arrow-right' },
         onClick: () => this.open()
      });
      if (button) this.$action.appendChild(button);

      (this._features || []).forEach((feature) => {
         const badge = document.createElement('span');
         badge.className = 'modulecard__feature';
         badge.textContent = feature;
         this.$features.appendChild(badge);
      });

      this.$root.addEventListener('click', () => this.open());
   }

   open() {
      if (!this._path) return;
      slice.router.navigate(this._path);
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
      if (this.$features) {
         this.$features.replaceChildren();
         this._features.forEach((feature) => {
            const badge = document.createElement('span');
            badge.className = 'modulecard__feature';
            badge.textContent = feature;
            this.$features.appendChild(badge);
         });
      }
   }

   get path() { return this._path; }
   set path(value) {
      this._path = value || null;
   }

   get actionLabel() { return this._actionLabel; }
   set actionLabel(value) {
      this._actionLabel = value || 'Abrir';
   }
}

customElements.define('slice-module-card', ModuleCard);
