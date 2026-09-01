// ConfirmActionModal — Diálogo único de confirmación, manejado por eventos.
//
// Nadie lo construye ni lo referencia: quien necesita confirmar algo emite
// `confirm:request` con sus callbacks y sigue. Este componente es el único
// suscripto y el único que conoce al Modal. El componente que pide la
// confirmación no se acopla ni al diálogo ni a su ciclo de vida.
//
//   slice.events.emit('confirm:request', {
//      title: 'Vaciar biblioteca',
//      message: 'Se eliminan todas las imágenes.',
//      confirmLabel: 'Vaciar',
//      danger: true,
//      onConfirm: () => this.clearPool()
//   });
//
// Se construye una sola vez desde Providers (composition root).

export default class ConfirmActionModal extends HTMLElement {

   constructor(props) {
      super();
      slice.attachTemplate(this);
      this._resolved = false;
      slice.controller.setComponentProps(this, props || {});
   }

   init() {
      // bind(this) para que la suscripción se limpie sola al destruirse y para
      // que el panel de eventos pueda atribuir quién escucha.
      this.events = slice.events.bind(this);
      this.events.subscribe('confirm:request', (payload) => this._open(payload));
   }

   async _ensureModal() {
      if (!this._modalPromise) this._modalPromise = this._buildModal();
      await this._modalPromise;
   }

   async _buildModal() {
      this.$modal = await slice.build('Modal', {
         sliceId: 'confirm-action-dialog',
         dismissable: true,
         maxWidth: '440px',
         onClose: () => this._handleClose()
      });
      this.$modal.classList.add('confirmmodal');
      document.body.appendChild(this.$modal);

      this.$message = document.createElement('p');
      this.$message.className = 'confirmmodal__message';
      this.$modal.appendBody(this.$message);

      this.$cancelBtn = await slice.build('Button', {
         value: 'Cancelar',
         variant: 'ghost',
         onClick: () => this._resolve(false)
      });

      this.$confirmBtn = await slice.build('Button', {
         value: 'Confirmar',
         variant: 'filled',
         onClick: () => this._resolve(true)
      });

      this.$modal.appendFooter(this.$cancelBtn);
      this.$modal.appendFooter(this.$confirmBtn);
   }

   async _open({
      title = '¿Confirmás esta acción?',
      message = '',
      confirmLabel = 'Confirmar',
      cancelLabel = 'Cancelar',
      danger = false,
      onConfirm = null,
      onCancel = null
   } = {}) {
      await this._ensureModal();

      this._onConfirm = onConfirm;
      this._onCancel = onCancel;
      this._resolved = false;
      this._title = title;

      this.$modal.title = title;
      this.$message.textContent = message;
      this.$message.hidden = !message;
      this.$cancelBtn.value = cancelLabel;
      this.$confirmBtn.value = confirmLabel;
      this.$confirmBtn.variant = danger ? 'danger' : 'filled';
      this.$modal.classList.toggle('confirmmodal--danger', !!danger);

      this.$modal.open = true;
   }

   _resolve(confirmed) {
      this._resolved = true;
      this.$modal.open = false;

      const callback = confirmed ? this._onConfirm : this._onCancel;
      callback?.();

      // Se anuncia el resultado además de invocar el callback: quien quiera
      // reaccionar (analítica, logs, el panel de eventos) no necesita haber
      // sido el que pidió la confirmación.
      slice.events.emit('confirm:resolved', {
         confirmed,
         title: this._title || ''
      });
   }

   /** Cerrar por backdrop, Escape o la × equivale a cancelar. */
   _handleClose() {
      if (!this._resolved) {
         this._onCancel?.();
         slice.events.emit('confirm:resolved', {
            confirmed: false,
            title: this._title || ''
         });
      }
      this._resolved = false;
   }
}

customElements.define('slice-confirm-action-modal', ConfirmActionModal);
