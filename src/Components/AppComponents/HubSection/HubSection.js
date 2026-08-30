export default class HubSection extends HTMLElement {

   constructor(props) {
      super();
      slice.attachTemplate(this);
      slice.controller.setComponentProps(this, props);
   }

   async init() {
      const modules = [
         {
            title: 'Designer',
            description: 'Editor de fuentes interactivo con previsualización en vivo y exportación PNG/SVG lista para vectorizar',
            icon: 'palette',
            features: ['Fuentes personalizadas', 'Previsualización', 'Exportación PNG/SVG'],
            path: '/designer'
         },
         {
            title: 'Canvas Interactivo',
            description: 'Editor avanzado con herramientas de dibujo, formas, texto editable e historial de deshacer/rehacer',
            icon: 'pen-tool',
            features: ['Fabric.js', 'Formas', 'Texto editable', 'Exportación'],
            path: '/canvas'
         },
         {
            title: 'Plantillas de Hoja',
            description: 'Imprimí varias imágenes en una sola hoja: plantillas editables, drag & drop y auto-acomodo inteligente',
            icon: 'layout-grid',
            features: ['Drag & drop', 'A4 / Carta / A5', 'Auto-acomodo'],
            path: '/layouts'
         }
      ];

      const grid = this.querySelector('.hubsection__gridslot');
      if (!grid) return;

      for (const module of modules) {
         const card = await slice.build('ModuleCard', module);
         if (card) grid.appendChild(card);
      }
   }
}

customElements.define('slice-hub-section', HubSection);