export default class ThemeSwitcher extends HTMLElement {
   static props = {
      themes: { type: 'array', default: ['Light', 'Dark'] },
      variant: { type: 'string', default: 'button', allowedValues: ['button', 'menu-item'] },
      label: { type: 'string', default: 'Tema' },
      onChange: { type: 'function', default: null }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$btn = this.querySelector('.theme-switcher');
      this.$icon = this.querySelector('.theme-switcher__icon');
      this.$value = this.querySelector('.theme-switcher__value');

      // Keep every theme control in the app (selector, switcher, menus) in sync.
      this._onThemeChanged = () => this._sync();
      this.$btn.addEventListener('click', () => this.cycle());

      slice.controller.setComponentProps(this, props);
   }

   async init() {
      document.addEventListener('themeChanged', this._onThemeChanged);
      this._sync();
   }

   beforeDestroy() {
      document.removeEventListener('themeChanged', this._onThemeChanged);
      if (this._iconEl) slice.controller.destroyComponent(this._iconEl);
      this._iconEl = null;
   }

   /** Advance to the next theme in `themes`, wrapping around at the end. */
   async cycle() {
      const list = this._themes;
      const current = this._currentTheme();
      const next = list[(list.indexOf(current) + 1) % list.length];
      await this.setTheme(next);
   }

   /** Apply a theme by name and notify every other theme control. */
   async setTheme(name) {
      try {
         await slice.setTheme(name);
         document.dispatchEvent(new CustomEvent('themeChanged', { detail: { themeName: name } }));
         if (typeof this._onChange === 'function') this._onChange(name);
      } catch (error) {
         slice.logger.logError('ThemeSwitcher', `Could not switch to theme "${name}"`, error);
      }
      this._sync();
   }

   _currentTheme() {
      return (
         slice.stylesManager?.themeManager?.currentTheme ||
         slice.theme ||
         this._themes[0]
      );
   }

   _isDark(name) {
      return /dark/i.test(String(name));
   }

   _targetTheme() {
      const list = this._themes;
      const current = this._currentTheme();
      return list[(list.indexOf(current) + 1) % list.length] || current;
   }

   _sync() {
      const target = this._targetTheme();

      // El icono muestra el tema destino: luna → pasar a oscuro, sol → a claro.
      const iconName = this._isDark(target) ? 'moon' : 'sun';
      this.$btn.classList.toggle('theme-switcher--to-dark', this._isDark(target));
      if (!this._iconEl && this.$icon) {
         slice.build('Icon', { name: iconName, size: '17', color: 'currentColor' })
            .then((el) => {
               if (!el) return;
               this._iconEl = el;
               this.$icon.replaceChildren(el);
            });
      } else if (this._iconEl) {
         this._iconEl.name = iconName;
      }

      const hint = `${this._label}: cambiar a ${target}`;
      this.$btn.setAttribute('aria-label', hint);
      this.$btn.title = hint;
      if (this.$value) {
         this.$value.textContent = this._variant === 'menu-item' ? target : '';
      }
   }

   get themes() {
      return this._themes;
   }

   set themes(value) {
      this._themes = Array.isArray(value) && value.length ? value : ['Light', 'Dark'];
      this._sync();
   }

   get variant() {
      return this._variant;
   }

   set variant(value) {
      this._variant = value === 'menu-item' ? 'menu-item' : 'button';
      this.classList.toggle('theme-switcher--menu', this._variant === 'menu-item');
      this.classList.toggle('theme-switcher--button', this._variant === 'button');
   }

   get label() {
      return this._label;
   }

   set label(value) {
      this._label = value || 'Tema';
   }

   get onChange() {
      return this._onChange;
   }

   set onChange(fn) {
      if (typeof fn === 'function') this._onChange = fn;
   }
}

customElements.define('slice-theme-switcher', ThemeSwitcher);
