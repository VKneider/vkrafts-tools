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
| `IndexedDbManager`, `StorageService` | solo `SheetStorage`, vía Providers |

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

> `get('grid-3x5')` **rehidrata** la grilla derivada si no está en memoria. Las
> derivadas no se persisten: sin esto, tras un F5 la capacidad de una hoja de
> producto bajaba a la de `m2x2` y el siguiente commit borraba las celdas de más.

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

> `createSheet(seq, current)` hereda **toda** la configuración de la hoja
> actual: papel, plantilla, márgenes, ajuste, escala, producto con tamaño fijo y
> pesos de columnas/filas (copiados, no compartidos). **No** copia el contenido:
> `placement` arranca vacío. "Nueva hoja" usa esa herencia; copiar las imágenes
> es `duplicateSheet`.

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

`exportPNGs` descarga un PNG cuando hay una sola hoja; con varias arma un único
ZIP (`fflate`) para evitar que el navegador bloquee descargas encadenadas.

`exportPDFExact()` devuelve `{ ok, paginas, items, imagenes, fallidas }` y **no
guarda** el archivo si había piezas y ninguna imagen pudo estamparse: un PDF de
páginas en blanco parece un bug del layout y esconde la causa real. La vista
entonces cae a `exportPDFRaster()`, que rasteriza cada hoja offscreen (el mismo
camino que PNG/Imprimir) para que el usuario se lleve lo que ve.

Además:

- las imágenes se precargan **una vez por URL** (dos celdas del mismo sticker no
  la decodifican dos veces);
- el `format` que recibe `addImage` se deduce del **data URL real**, no de la
  extensión del archivo (rotar/voltear guardan PNG con nombre `.jpg`);
- las hojas sin ninguna imagen colocada no se exportan: no generan páginas
  fantasma en el PDF/PNG ni una hoja de más al imprimir;
- el crop global del asset se respeta en la exportación: con zoom manual
  (`cropScale > 1`) el PDF rasteriza la vista recortada con la misma semántica
  de `background-size`/`background-position` que la celda; PNG e impresión usan
  la hoja offscreen, que aplica el mismo encuadre;
- `printSheets()` es **async** y espera a que el iframe decodifique las imágenes
  (`waitForImages(doc.body, win)`) antes de llamar a `print()`. Sin eso la vista
  previa podía abrirse en blanco: el iframe es otro documento y carga los
  `background-image` de cero.

> **jsPDF se carga desde `/vendor/jspdf.umd.min.js`** (`src/public/vendor/`) con
> un `<script>` en vez de `import ... from 'jspdf'`. El empaquetador de Slice
> indenta el código minificado de las dependencias externas y eso inyecta 4
> espacios dentro de los literales de plantilla de jsPDF: todos los streams del
> PDF quedan corridos y el archivo sale con las hojas en blanco. Como asset
> estático no pasa por ese paso.

`exportCalibrationSheet()` genera una hoja de prueba con una regla de 100 mm.
Sirve para que el usuario distinga "la app mide mal" de "mi impresora reescala",
que es lo que casi todos los drivers hacen por defecto. El método y su unit test
se conservan, pero **ya no se expone como botón** en la barra de acciones.

**Contrato de geometría:** el renderizado usa píxeles CSS que equivalen 1:1 a
milímetros reales (96dpi ⇒ 1 mm = 96/25.4 px). Gracias a eso la impresión sale a
tamaño real sin conversión, y el DPI del raster lo decide solo el `scale` de
html2canvas.

---

## Infraestructura de datos

### `IndexedDbManager`
Wrapper de IndexedDB con la API actual: una sola conexión compartida,
`stores` declarativos (stores e índices se crean/actualizan sin perder datos),
`store(name)` para `get/getAll/count/query/add/put/delete/clear` y
`transaction([...], mode, fn)` para operaciones atómicas. La API vieja
(`addItem`, `getItem`, …) sigue existiendo como compatibilidad deprecada, pero
`SheetStorage` ya usa `store('pool')`.

Se instancia con `databaseName`, `storeName` y `stores`, así que lleva `sliceId`
propio (`vkrafts-pool-db`) en vez de `singleton: true`.

### `StorageService`
Wrapper de localStorage/sessionStorage con JSON, **namespace**, `ttl` por valor,
`watch()` (misma pestaña y otras), fallback a memoria si el navegador bloquea el
storage y `false` en vez de excepción cuando la cuota está llena.

`SheetStorage` lo construye con `namespace: 'vkrafts'` y la key `sheet-layout`,
que produce `vkrafts:sheet-layout` (la misma clave histórica de la app). Los
blobs siguen en `IndexedDbManager`. Emite `sheet:save`
(`saving`/`saved`/`warning`/`error`) para que la vista muestre el estado de
guardado. `saveAsset()` consulta `navigator.storage.estimate()` y emite
`warning` cuando la cuota está al 85% o más, antes de que la escritura falle.

> `LocalStorageManager` era la API anterior y Slice la marca como deprecada. La
> app ya no lo usa y se eliminó del proyecto; `StorageService` es el reemplazo.

---

## Al agregar un servicio

1. Crearlo en `Components/Service/<Nombre>/<Nombre>.js`.
2. Registrarlo en `Components/components.js`.
3. Construirlo en `Providers.init()` con `{ singleton: true }`, respetando el
   orden de dependencias.
4. Recuperarlo con `slice.getComponent('<Nombre>')`.
5. Si tiene lógica pura, agregar su `.test.js` al lado.
