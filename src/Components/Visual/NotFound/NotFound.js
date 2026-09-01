export default class NotFound extends HTMLElement {

   static props = {};

   constructor(props) {
      super();
      slice.attachTemplate(this);

      slice.controller.setComponentProps(this, props);
   }

   async init() {
      document.title = 'VKRAFTS · Página no encontrada';

      const container = this.querySelector('.home-btn-container');
      if (container) {
         const homeBtn = await slice.build('Button', {
            value: 'Volver al inicio',
            customColor: { background: 'var(--primary-color-contrast)', text: 'var(--primary-color)' },
            onClick: () => slice.router.navigate('/'),
         });
         container.appendChild(homeBtn);
      }
   }
}

customElements.define('slice-notfound', NotFound);
