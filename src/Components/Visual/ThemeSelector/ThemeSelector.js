export default class ThemeSelector extends HTMLElement {
  constructor(props) {
    super();
    slice.attachTemplate(this);
    slice.controller.setComponentProps(this, props);
  }

  async init() {
    this.$toggle = this.querySelector('.theme-toggle');
    this.$light = this.querySelector('.toggle-light');
    this.$dark = this.querySelector('.toggle-dark');

    this.currentTheme = slice.stylesManager?.themeManager?.currentTheme || 'LIGHT';
    this.syncActive();

    this.$toggle.addEventListener('click', () => this.toggle());

    // El handler se guarda para poder removerlo: con una función anónima el
    // listener quedaba enganchado al documento por cada instancia creada.
    this._onThemeChanged = (event) => {
      this.currentTheme = event.detail?.themeName ?? this.currentTheme;
      this.syncActive();
    };
    document.addEventListener('themeChanged', this._onThemeChanged);
  }

  beforeDestroy() {
    document.removeEventListener('themeChanged', this._onThemeChanged);
  }

  syncActive() {
    this.$light.classList.toggle('active', this.currentTheme === 'LIGHT');
    this.$dark.classList.toggle('active', this.currentTheme === 'DARK');
  }

  async toggle() {
    const next = this.currentTheme === 'LIGHT' ? 'DARK' : 'LIGHT';
    this.$toggle.classList.add('loading');
    try {
      await slice.setTheme(next);
      this.currentTheme = next;
      this.syncActive();
      document.dispatchEvent(new CustomEvent('themeChanged', {
        detail: { themeName: next }
      }));
    } catch (error) {
      console.error('Error changing theme:', error);
    } finally {
      this.$toggle.classList.remove('loading');
    }
  }
}

customElements.define('slice-theme-selector', ThemeSelector);
