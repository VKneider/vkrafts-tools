import { confirmEvents } from '../../../events/confirm.events.js';

// ── Composition root ─────────────────────────────────────────────────────
// Boots every singleton service in order, then steps back. AppShell.init()
// awaits `slice.build('Providers', { singleton: true })` before mounting any
// section. After init(), recover a service anywhere with:
//   slice.getComponent('FontsCatalog') / slice.getComponent('ToastProvider')
export default class Providers {
   constructor(props) {
      this.props = props || {};
      this._ready = false;
   }

   async init() {
      if (this._ready) return this;

      // 1) Datos: catálogo de fuentes usado por Designer y Canvas.
      await slice.build('FontsCatalog', { singleton: true });

      // 2) Infraestructura compartida.
      await slice.build('HtmlService', { singleton: true });
      await slice.build('ShareService', { singleton: true });
      await slice.build('DownloadService', { singleton: true });
      await slice.build('ToolTipProvider', { singleton: true });
      await slice.build('LayoutTemplates', { singleton: true });
      await slice.build('SheetGeometry', { singleton: true });

      // Persistencia de Plantillas: los binarios de las imágenes en IndexedDB
      // y la estructura de hojas en localStorage. SheetStorage une las dos.
      const poolService = await slice.build('PoolService', { singleton: true });
      // StorageService reemplaza al deprecado LocalStorageManager. Con
      // namespace 'vkrafts' + key 'sheet-layout' la clave resultante es
      // 'vkrafts:sheet-layout': exactamente la que ya usaba la app, así que
      // las sesiones existentes se siguen leyendo sin migración.
      // IndexedDB sigue a cargo de los blobs (IndexedDbManager).
      const localStore = await slice.build('StorageService', {
         singleton: true,
         sliceId: 'vkrafts-storage',
         namespace: 'vkrafts'
      });
      // Este sí lleva sliceId propio: es una instancia configurada para una base
      // y un store concretos, no el único IndexedDbManager posible de la app.
      // La versión actual del servicio abre una sola conexión, crea/actualiza
      // stores e índices declarados y expone store(name) + transacciones.
      const sheetDb = await slice.build('IndexedDbManager', {
         sliceId: 'vkrafts-pool-db',
         databaseName: 'vkrafts',
         storeName: 'pool',
         stores: {
            pool: { keyPath: 'id' }
         }
      });

      await slice.build('SheetStorage', {
         singleton: true,
         db: sheetDb,
         storage: localStore,
         poolService
      });

      // Estado del módulo Plantillas de Hoja: pool compartido + múltiples hojas.
      const firstSheet = {
         id: 'sheet-1',
         pageId: 'carta',
         templateId: 'm2x2',
         presetId: 'none',
         fitMode: 'smart',
         imageScale: 1,
         placement: {}
      };
      slice.context.create('sheet', {
         activeId: firstSheet.id,
         pool: [],
         sheets: [firstSheet],
         zoom: 0.7
      });

      // 3) Estado compartido del Designer (toolbar ↔ sección ↔ cards).
      slice.context.create('designer', {
         texto: '',
         fontSize: 48,
         textColor: '#000000',
         bgColor: 'transparent',
         styles: {
            bold: false,
            italic: false,
            underline: false,
            align: 'center',
            letterSpacing: 0,
            mirrored: false,
            rotation: 0
         },
         category: 'corrido'
      });

      // 2) Notificaciones: provider único de toasts + bridge por eventos,
      //    para emitir desde cualquier punto sin acoplarse al servicio.
      const toasts = await slice.build('ToastProvider', { singleton: true });
      toasts.setPosition?.('bottom-right');

      if (slice.events?.register) {
         slice.events.register('toast', {
            show: {
               description: 'Show a toast notification',
               payload: { message: 'string', type: 'string', duration: 'number' }
            }
         });
         slice.events.subscribe('toast:show', (payload = {}) => {
            toasts.show(payload.message ?? '', {
               type: payload.type ?? 'info',
               duration: payload.duration ?? undefined
            });
         });

         slice.events.register(confirmEvents);

         slice.events.register('sheet', {
            save: {
               description: 'Estado del guardado de la planilla',
               payload: { status: 'string', message: 'string' }
            }
         });
      }

      // Diálogo de confirmación: se monta una sola vez y queda escuchando
      // `confirm:request`. Ninguna vista necesita construirlo ni conocerlo.
      const confirmModal = await slice.build('ConfirmActionModal');
      if (confirmModal) document.body.appendChild(confirmModal);

      this._ready = true;
      return this;
   }
}
