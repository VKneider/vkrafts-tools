# Servicios

Los Services son clases sin DOM. Se levantan una vez en `Providers` y se
recuperan con `slice.getComponent('Nombre')`. Al no tocar el DOM se testean como
JavaScript común, que es por qué la lógica pesada vive acá y no en las vistas.

## Índice por consumidores

| Servicio | Consumido por |
|---|---|
| `ToolTipProvider` | 7 componentes |
| `ToastProvider` | 5 vistas + FontCard |
| `DownloadService` | CanvasSection, FontDetailSection, FontCard |
| `FontsCatalog` | Canvas, Designer, FontDetail |
| `HtmlService` | FontDetail, FontCard |
| `ShareService` | Designer, FontDetail |
| `DragDropService` | LayoutsSection, Modal |
| `LayoutTemplates`, `SheetGeometry`, `PoolService`, `SheetStorage` | LayoutsSection |
| `ExportService`, `PlacementService`, `SheetService` | solo LayoutsSection |
| `IndexedDbManager`, `LocalStorageManager` | solo `SheetStorage`, vía Providers |

---

## Transversales

### `ToastProvider`
Notificaciones. Se usa directo (`show(mensaje, { type })`) o por evento
(`toast:show`), que permite avisar desde cualquier punto sin acoplarse.

### `ToolTipProvider`
Tooltips. `attach(el, {...})` para uno puntual y `scope(contenedor)` para todos
los `[data-tooltip]` de un subárbol. **Hay que hacer `detach()`** en
`beforeDestroy` de quien los adjuntó.

### `DownloadService`
Wrapper único de descargas. Existe porque el patrón "creo un `<a>`, click y
listo" tiene dos trampas que estaban repetidas en cuatro lugares:

1. Firefox **ignora el click** si el anchor no está en el documento.
2. Revocar la object URL justo después del click **aborta la descarga**.

API: `blob()`, `url()`, `text()`, `canvas()`. Ninguna vista debería volver a
crear un anchor a mano.

### `HtmlService`
`sanitize()` (DOMPurify) y `escape()`. Se usa antes de meter texto del usuario
en el SVG exportado.

### `DragDropService`
Drag & drop, drop targets, resize y sortable. Guarda los nodos en un `Map`
**y no los suelta solo**: hay que llamar a `detach(nodo)` cuando el nodo muere,
o se acumulan render tras render. Su CSS se inyecta en el `<head>` y deriva de
los tokens del tema.

---

## Designer y Canvas

### `FontsCatalog`
Catálogo de fuentes. Solo datos.

### `ShareService`
Serializa un diseño de fuente en la URL
(`/font/{id}?t=…&s=…&c=…`) y lo vuelve a parsear. Clampea y valida todo lo que
entra por query string.

---

## Plantillas

Cinco servicios, cada uno con una responsabilidad clara. La vista orquesta; ellos
deciden.

### `LayoutTemplates`
Catálogo: tamaños de página (A4, Carta, A5), plantillas de grilla y presets de
margen. Además **tamaños de producto** (foto 10×15, sticker 5×5, tarjeta…) con
dos métodos clave:

- `gridForProduct(product, pageId, presetId)` — cuántas piezas entran.
- `ensureGrid(cols, rows)` — registra al vuelo una plantilla derivada (`grid-4x5`),
  porque las grillas de producto son arbitrarias y no están en el catálogo fijo.

### `SheetGeometry`
Matemática pura de la hoja. Sin estado y sin DOM.

- `geometry(...)` — ancho y alto de cada columna y fila en mm. Tiene un **modo
  de celda fija**: con un tamaño de producto la celda mide exactamente lo pedido
  y lo que sobra queda como margen, en vez de estirarse.
- `cellRects(...)` — el rectángulo de cada celda **en milímetros** desde la
  esquina de la hoja. Es lo que permite que el PDF sea exacto.
- `imageRect(...)` — dónde cae la imagen dentro de la celda, replicando la
  semántica de `background-size` de la vista previa. Devuelve `crop: true` solo
  para `cover`, que es el único caso que necesita recorte.

### `PlacementService`
Algoritmos de colocación: `smartAssign` (ordena por área y busca el mejor encaje
por proporción y orientación), `fillGradually`, `placeInSlot`, `clearPlacements`.
Recibe **assets**, no ids.

### `SheetService`
Alta, baja y cambio de hoja activa.

> `createSheet(seq, current)` acepta una hoja de la que heredar configuración.
> La vista **no le pasa** ese segundo argumento a propósito: "Nueva hoja" crea en
> blanco, y copiar es `duplicateSheet`.

### `PoolService`
CRUD de la biblioteca: `measure`, `createAsset`, `createAssetDirect`,
`removeAsset` (revoca la object URL), `findById`, `disposeAll`.

### `SheetStorage`
Persistencia. Parte el estado en dos porque los medios y la estructura tienen
soportes distintos — ver [ARQUITECTURA.md](./ARQUITECTURA.md).

`scheduleSave()` agrupa con debounce, `flush()` fuerza el guardado pendiente,
`restore()` reconstruye y descarta celdas huérfanas, `clearAssets()` vacía la
biblioteca conservando las hojas, `updateAssetQuantity()` cambia solo la cantidad
sin reescribir el blob.

### `ExportService`
Las tres salidas, y **no son equivalentes en precisión**:

| Salida | Precisión |
|---|---|
| **PDF** (`exportPDFExact`) | Exacto. Estampa cada imagen en coordenadas en mm; no rasteriza el layout |
| **Impresión** (`printSheets`) | Exacto en CSS, pero el driver puede reescalar |
| **PNG** (`exportPNGs`) | Sin tamaño físico: un PNG son píxeles. Para imprimir, PDF |

`exportCalibrationSheet()` genera una hoja de prueba con una regla de 100 mm.
Sirve para que el usuario distinga "la app mide mal" de "mi impresora reescala",
que es lo que casi todos los drivers hacen por defecto.

**Contrato de geometría:** el renderizado usa píxeles CSS que equivalen 1:1 a
milímetros reales (96dpi ⇒ 1 mm = 96/25.4 px). Gracias a eso la impresión sale a
tamaño real sin conversión, y el DPI del raster lo decide solo el `scale` de
html2canvas.

---

## Infraestructura de datos

### `IndexedDbManager`
Wrapper de IndexedDB (`addItem`, `updateItem`, `getItem`, `deleteItem`,
`getAllItems`, `clearItems`). Se instancia con `databaseName` y `storeName`, así
que lleva `sliceId` propio en vez de `singleton: true`.

### `LocalStorageManager`
`getItem` / `setItem` con JSON y try-catch. Devuelve `null` o `false` en vez de
tirar, para degradar sin romper cuando el navegador bloquea el almacenamiento.

---

## Al agregar un servicio

1. Crearlo en `Components/Service/<Nombre>/<Nombre>.js`.
2. Registrarlo en `Components/components.js`.
3. Construirlo en `Providers.init()` con `{ singleton: true }`, respetando el
   orden de dependencias.
4. Recuperarlo con `slice.getComponent('<Nombre>')`.
5. Si tiene lógica pura, agregar su `.test.js` al lado.
