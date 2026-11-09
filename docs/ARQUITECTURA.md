# Arquitectura

## Cómo arranca

1. `App/index.js` importa `/Slice/Slice.js` — efecto de lado que carga el
   runtime y expone `slice` como global. El archivo está casi vacío a
   propósito: solo iría acá un guard de router.
2. El router arranca solo y monta la ruta que corresponda.
3. Todas las rutas salvo `/404` montan **`AppShell`**.
4. `AppShell.init()` hace lo primero que importa:
   `await slice.build('Providers', { singleton: true })`. Recién después
   construye la navbar y el `MultiRoute`.

Ese orden no es casual: **toda vista asume que `Providers` ya terminó**. Si una
sección se montara antes, `slice.getComponent('ToastProvider')` devolvería
`undefined`.

## Rutas

| Ruta | Componente | Notas |
|---|---|---|
| `/` | AppShell → HubSection | |
| `/designer` | AppShell → DesignerSection | |
| `/canvas` | AppShell → CanvasSection | |
| `/layouts` | AppShell → LayoutsSection | |
| `/font/${id}` | AppShell → FontDetailSection | Parámetro dinámico: `${id}`, no `:id` |
| `/about` | AppShell → AboutSection | |
| `/404` | NotFound | **Sin shell**: no tiene navbar |

`routes.js` declara la ruta → `AppShell`; el mapeo fino a cada sección vive en
el `MultiRoute` que arma `AppShell.init()`. Agregar una vista implica tocar los
dos lugares.

## Composition root

`Components/Providers/Providers/Providers.js` es el único lugar donde se
levantan singletons. Construye, en orden:

1. `FontsCatalog` — datos de fuentes
2. Infraestructura: `HtmlService`, `ShareService`, `DownloadService`,
   `ToolTipProvider`, `LayoutTemplates`, `SheetGeometry`
3. Persistencia de Plantillas: `PoolService`, `StorageService`,
   `IndexedDbManager` (con `sliceId` propio) y `SheetStorage`
4. Los contextos `sheet` y `designer`
5. `ToastProvider` + el puente de eventos
6. `ConfirmActionModal`, que queda escuchando

Después de eso cualquier componente recupera lo que necesita con
`slice.getComponent('Nombre')`.

**Sobre `singleton: true`:** para un Service devuelve la instancia ya construida
si existe, así que sirve tanto para crear como para recuperar. `IndexedDbManager`
es la excepción y lleva `sliceId` propio (`vkrafts-pool-db`): es una instancia
configurada para una base y un store concretos, no el único posible de la app.

## Estado

Dos contextos, ninguno compartido entre módulos.

### `sheet` — Plantillas

```js
{ activeId: string, sheets: Sheet[], pool: Asset[], zoom: number }
```

Una `Sheet` lleva `pageId`, `templateId`, `presetId`, `fitMode`, `imageScale`,
`placement` (mapa slot → `{refId, fit}`), los pesos `cols`/`rows` y, si se eligió
un tamaño de producto, `productId` y `cellSizeMm`.

> **`context.set()` REEMPLAZA el estado entero.** Toda escritura parcial tiene
> que esparcir `prev`, o se pierden silenciosamente el pool y el zoom. Para
> cambiar un solo campo está `patch()`.

### `designer` — Designer

Texto, tamaño, colores y estilos. `DesignerToolbar` escribe con `patch()` y
`DesignerSection` observa: no se referencian entre sí.

## Eventos

El catálogo está declarado en `events/confirm.events.js` y se registra en
`Providers` con `slice.events.register()`. Declararlos habilita validación en
desarrollo, tipos vía `slice types generate` y trazado en el panel de eventos
(`alt+shift+e`).

| Evento | Emite | Escucha |
|---|---|---|
| `toast:show` | cualquiera | `Providers` → `ToastProvider` |
| `confirm:request` | LayoutsSection, CanvasSection | `ConfirmActionModal` |
| `confirm:resolved` | `ConfirmActionModal` | nadie por ahora (queda para analítica/trazado) |

### Confirmaciones

Quien necesita confirmar algo emite y sigue; no conoce al modal ni lo construye:

```js
slice.events.emit('confirm:request', {
  title: 'Vaciar la biblioteca',
  message: 'Se eliminan las 12 imágenes…',
  confirmLabel: 'Vaciar todo',
  danger: true,
  onConfirm: () => this._doClearPool()
});
```

**Criterio para decidir si una acción se confirma:** solo cuando hay algo real
que perder. Una hoja vacía se borra sin preguntar, una imagen sin colocar
también. Confirmar cuando no hay nada en juego entrena a aceptar sin leer, y ahí
el diálogo deja de servir justo cuando importa.

| Acción | Confirma |
|---|---|
| Vaciar biblioteca | siempre |
| Vaciar canvas | siempre |
| Limpiar hoja | si hay celdas ocupadas |
| Eliminar hoja | si tiene imágenes |
| Eliminar imagen del pool | si está colocada en alguna hoja |
| Vaciar una celda | no — la imagen queda en la biblioteca |
| Borrar selección en canvas | no — un Ctrl+Z lo revierte |

## Persistencia

Solo Plantillas persiste, y parte el estado según el soporte:

- **Binarios de las imágenes → IndexedDB.** Las object URLs (`blob:`) mueren con
  el documento, así que guardarlas no serviría: se guarda el blob y se regenera
  la URL al restaurar.
- **Estructura de hojas → localStorage.** Chica y serializable.

Los ids de asset se preservan entre sesiones, así que los `refId` de cada celda
siguen apuntando bien. Al restaurar se descartan las celdas cuyo asset ya no
exista, para no dejar huecos sin explicación.

El guardado va con debounce de 600 ms porque el watcher del contexto dispara en
cada commit, con un `flush()` al desmontar la vista.

## Convenciones de Slice que este proyecto respeta

Vale tenerlas presentes porque no coinciden con React o Vue:

- El DOM **no existe** hasta `slice.attachTemplate(this)`. Después de esa
  llamada sí se puede hacer `querySelector` dentro del constructor.
- Las props pasan por **setters**, y ahí van los efectos. Por eso
  `setComponentProps` va **último** en el constructor.
- `slice.build()` es **async**: siempre con `await`.
- Los componentes se registran en `components.js`.
- Vaciar con `innerHTML` no destruye componentes: hay que usar
  `destroyComponent` / `destroyByContainer` para que corra `beforeDestroy`.
- Las suscripciones hechas con `slice.events.bind(this)` y `context.watch` se
  limpian solas; los listeners globales (`document`, `window`) no.

## Tests

`vitest` cubre los servicios puros: `PlacementService`, `SheetService`,
`PoolService`, `ExportService`, `SheetGeometry` y `LayoutTemplates`. Son lógica
sin DOM, así que se testean como JavaScript común.

Las vistas tienen E2E con **Playwright local** en [`tests/e2e`](../tests/e2e/README.md):
levanta `slice dev --port 3101` y usa Chromium. Cubre medidas exactas, PDF/PNG,
impresión, persistencia, hojas (rail, renombrar/mover), atajos y las features
nuevas. Se ejecuta con `pnpm test:e2e`.
