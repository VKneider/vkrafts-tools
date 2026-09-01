// Catálogo del dominio "confirm". Se registra en Providers.init().
//
// El flujo es pub/sub puro: quien necesita una confirmación emite
// `confirm:request` y sigue con su vida; ConfirmActionModal es el único que
// escucha y el que resuelve. Nadie tiene que conocer al modal ni construirlo.
export const confirmEvents = {
   'confirm:request': {
      description: 'Pide confirmación al usuario antes de una acción destructiva',
      payload: {
         title: 'string',
         message: 'string',
         confirmLabel: 'string',
         cancelLabel: 'string',
         danger: 'boolean',
         onConfirm: 'function',
         onCancel: 'function'
      }
   },
   'confirm:resolved': {
      description: 'El usuario respondió el diálogo de confirmación',
      payload: {
         confirmed: 'boolean',
         title: 'string'
      }
   }
};

export default confirmEvents;
