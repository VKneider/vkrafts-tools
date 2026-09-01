// Catálogo de módulos del taller. Se mantiene acá (y no en un Service) porque
// es contenido de la landing, no estado compartido.
// Cada módulo tiene su color y su inclinación: ninguna card queda igual a la
// de al lado. Los colores salen de los tokens del tema, así que Light y Dark se
// resuelven solos.
const MODULES = [
   {
      title: 'Designer',
      description:
         'Escribí, elegí una fuente y llevátelo listo para cortar en vinilo.',
      icon: 'palette',
      features: ['Fuentes copadas', 'Vista en vivo', 'PNG / SVG'],
      path: '/designer',
      accent: 'var(--secondary-color)',
      accentInk: 'var(--secondary-color-contrast)'
   },
   {
      title: 'Canvas',
      description:
         'Hoja en blanco para hacer lo que quieras: formas, textos y deshacer sin culpa.',
      icon: 'pen-tool',
      features: ['Formas', 'Texto editable', 'Ctrl+Z infinito'],
      path: '/canvas',
      accent: 'var(--primary-color)',
      accentInk: 'var(--primary-color-contrast)'
   },
   {
      title: 'Plantillas',
      description:
         'Meté un montón de imágenes en una hoja y mandalas a imprimir a tamaño real.',
      icon: 'layout-grid',
      features: ['Arrastrar y soltar', 'A4 · Carta · A5', 'Se acomoda solo'],
      path: '/layouts',
      accent: 'var(--success-color)',
      accentInk: 'var(--success-contrast)'
   }
];

export default class HubSection extends HTMLElement {

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$grid = this.querySelector('[data-ref="grid"]');

      slice.controller.setComponentProps(this, props);
   }

   async init() {
      if (!this.$grid) return;

      // Reveal escalonado: las cards entran después del hero.
      const BASE_DELAY = 400;
      const STEP = 100;

      for (const [i, module] of MODULES.entries()) {
         const card = await slice.build('ModuleCard', {
            ...module,
            index: i + 1,
            revealDelay: BASE_DELAY + i * STEP
         });
         if (card) this.$grid.appendChild(card);
      }
   }

   beforeDestroy() {
      slice.controller.destroyByContainer(this);
   }
}

customElements.define('slice-hub-section', HubSection);
