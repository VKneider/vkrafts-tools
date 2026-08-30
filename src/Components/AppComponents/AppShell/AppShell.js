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

      // Persistent navbar — built once, stays across navigations.
      // El cambio de tema vive integrado al navbar (extras → ThemeSwitcher).
      const navbar = await slice.build('Navbar', {
         sliceId: 'app-navbar',
         position: 'fixed',
         items: [
            { text: 'Hub', path: '/' },
            { text: 'Designer', path: '/designer' },
            { text: 'Canvas', path: '/canvas' },
            { text: 'Plantillas', path: '/layouts' }
         ],
         extras: [
            { component: 'ThemeSwitcher', props: { themes: ['Light', 'Dark'], label: 'Tema' } }
         ]
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
            { path: '/font/${id}', component: 'FontDetailSection' },
            { path: '/about', component: 'AboutSection' }
         ]
      });
      this.$content.appendChild(content);
   }
}

customElements.define('slice-app-shell', AppShell);
