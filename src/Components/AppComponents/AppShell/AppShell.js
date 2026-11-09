export default class AppShell extends HTMLElement {
   constructor(props) {
      super();
      slice.attachTemplate(this);
      this.$header = this.querySelector('.app-shell__header');
      this.$content = this.querySelector('.app-shell__content');
      slice.controller.setComponentProps(this, props);
   }

   async init() {
      // Composition root: boots every singleton service. Every section depends
      // on this having completed before it mounts.
      await slice.build('Providers', { singleton: true });

      // Pre-build ThemeSwitcher with a literal name so the bundler resolves it.
      const themeSwitcher = await slice.build('ThemeSwitcher', {
         themes: ['Light', 'Dark'],
         label: 'Tema'
      });

      // Persistent navbar — built once, stays across navigations.
      const navbar = await slice.build('Navbar', {
         sliceId: 'app-navbar',
         position: 'fixed',
         logo: { src: '/images/favicon.svg', path: '/' },
         items: [
            { text: 'Hub', path: '/' },
            { text: 'Designer', path: '/designer' },
            { text: 'Canvas', path: '/canvas' },
            { text: 'Plantillas', path: '/layouts' }
         ],
         extraNodes: [themeSwitcher]
      });
      this.$header.appendChild(navbar);

      // Content area — a MultiRoute swaps the matching section by URL.
      // MultiRoute caches each section instance, so give sections an update()
      // method if they show dynamic data.
      const content = await slice.build('MultiRoute', {
         sliceId: 'app-content',
         routes: [
            { path: '/', component: 'HubSection' },
            { path: '/designer', component: 'DesignerSection' },
            { path: '/canvas', component: 'CanvasSection' },
            { path: '/layouts', component: 'LayoutsSection' },
            // Sintaxis de ruta de Slice: `${id}` es un parámetro, no un template.
            // eslint-disable-next-line no-template-curly-in-string
            { path: '/font/${id}', component: 'FontDetailSection' },
            { path: '/about', component: 'AboutSection' }
         ]
      });
      this.$content.appendChild(content);
   }
}

customElements.define('slice-app-shell', AppShell);
