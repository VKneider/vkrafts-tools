# Vistas y sus componentes

Cada vista es un **AppComponent** que el `MultiRoute` del shell monta según la
URL. Acá está, vista por vista, qué componentes son **propios** (los usa solo
ella) y cuáles **comparte** con el resto.

La distinción importa al tocar código: un componente propio se puede cambiar
libremente; uno compartido tiene otros consumidores que hay que revisar.

---

## AppShell — el marco

Se monta en **todas** las rutas y no cambia al navegar.

| Componente | Rol |
|---|---|
| `Providers` | Composition root. Se construye primero y de él dependen todas las vistas |
| `Navbar` | Barra fija superior. A su vez usa `Link` y `DropDown` |
| `ThemeSwitcher` | Alterna Light/Dark |
| `MultiRoute` | Área de contenido: intercambia la sección según la URL |

`MultiRoute` **cachea las instancias** de cada sección, así que al volver a una
vista no se reconstruye: se le llama `update()`. Por eso las secciones con datos
dinámicos definen ese método.

---

## HubSection — `/`

La portada. No tiene lógica más allá de listar los módulos.

| Propio | Rol |
|---|---|
| `ModuleCard` | Card de módulo. Recibe `accent` y `accentInk` para pintarse con su color |

El catálogo de módulos vive en una constante `MODULES` dentro de la propia
vista, no en un Service: es contenido de la landing, no estado compartido.

---

## DesignerSection — `/designer`

| Propio | Rol |
|---|---|
| `DesignerToolbar` | Controles de texto, tamaño, color y estilos. Escribe en el contexto `designer` |
| `FontCard` | Card de fuente con previsualización y descargas |
| `Grid` | Grilla del catálogo |

| Compartido | También lo usa |
|---|---|
| `Tabs` | CanvasSection |

**Estado:** contexto `designer`. La toolbar escribe con `patch()` y la sección
observa — no se hablan directamente.

**Servicios:** `FontsCatalog` (datos), `ShareService` (link con el diseño en la
URL), `ToastProvider`.

---

## CanvasSection — `/canvas`

La vista con más lógica propia, pero sin componentes exclusivos: arma su UI con
piezas compartidas y delega el lienzo en Fabric.js.

| Compartido | También lo usa |
|---|---|
| `Button` | casi toda la app |
| `Input` | DesignerToolbar |
| `Select` | LayoutsPanel |
| `Tabs` | DesignerSection |

**Historial:** mantiene su propia pila de snapshots (50 máximo). Las operaciones
en lote pasan por `_batch()`, que agrupa todo en **una sola entrada** — sin eso,
borrar veinte objetos costaba veinte Ctrl+Z.

**Servicios:** `FontsCatalog`, `DownloadService`, `ToastProvider`.

---

## LayoutsSection — `/layouts`

La vista más grande, y la única con una familia entera de componentes propios.

| Propio | Rol |
|---|---|
| `LayoutsPanel` | Panel lateral: carga, biblioteca, plantillas, grilla/márgenes personalizados, productos, ajuste y escala |
| `PoolCard` | Miniatura de la biblioteca, con el control de cantidad de copias |
| `SheetCell` | Celda de la hoja: imagen, estado vacío y menú contextual |
| `CellSizeModal` | Edición de medidas de columna/fila (con uniforme y bloqueo de proporción) |
| `ExportSheetsModal` | Selección de hojas y formato para exportar (PDF, PNGs/ZIP, imprimir) |
| `ContextMenu` | Menú del click derecho sobre una celda y sobre un chip de hoja |

| Compartido | También lo usa |
|---|---|
| `DropZone` | (lo monta `LayoutsPanel`) |
| `Select`, `Button` | resto de la app |

**Servicios propios:** `ExportService`, `PlacementService`, `SheetService`.
**Compartidos:** `PoolService`, `SheetStorage`, `LayoutTemplates`,
`SheetGeometry`, `DragDropService`, `ToastProvider`, `ToolTipProvider`.

**Estado:** contexto `sheet` — `{ activeId, sheets[], pool[], zoom }`.

Dos detalles que conviene tener presentes antes de tocarla:

- `context.set()` **reemplaza** el estado completo. Toda escritura tiene que
  esparcir `prev` o se pierden el pool y el zoom.
- Las celdas y las tarjetas de biblioteca **se reusan por `sliceId`**
  (`sheet-cell-<n>`, `pool-card-<id>`): se refrescan con `setComponentProps` en
  vez de destruirse y reconstruirse.

### Hojas y auto acomodar

- **+ Nueva hoja** hereda la configuración de la hoja activa (papel, plantilla,
  márgenes, ajuste, escala, producto y pesos de columnas/filas) y arranca
  vacía. **⧉ Duplicar** es la que copia además las imágenes.
- **El papel es global**: cambiarlo aplica el mismo tamaño a todas las hojas.
  Se elige **solo con el Select** (A4/Carta/A5, horizontales incluidas); el PDF
  respeta esa orientación. No hay inputs de ancho/alto.
- **Grilla y márgenes personalizados** desde el panel: columnas/filas (1–12) y
  margen/separación en cm; se rehidratan desde el id después de recargar. La
  hoja inicial arranca con **Sin margen** (0 mm) por defecto.
- **Productos estándar**: fotos, stickers, tarjeta, credencial, etiqueta y
  tamaños de **carnet (3×4, 4×4, 2,5×3,5) / pasaporte (3,5×4,5)**.
- **Zoom por celda**: rueda sobre la imagen, **Alt+arrastrar** para encuadrar,
  doble clic para resetear y un **Slider “Zoom de la imagen” en el panel** que
  actúa sobre la celda/imagen seleccionada (100–300 %). El encuadre se guarda
  en la imagen: todas sus copias y hojas lo comparten.
- **Selección múltiple**: `Ctrl/Cmd` alterna celdas, `Shift` toma rangos;
  `Shift+flechas` extiende el rango y `Ctrl/Cmd+A` selecciona toda la hoja. El
  menú contextual ajusta (cubrir/contener) o quita en lote.
- **Biblioteca**: búsqueda por nombre, paginación de a 12 y estado vacío.
  **Vaciar** borra las imágenes y reinicia la planilla a una sola hoja blanca.
  Se puede arrastrar una imagen a una celda, intercambiar celdas arrastrando y
  pegar imágenes con `Ctrl+V`.
- **Guardado**: el topbar muestra “Guardando… / Guardado” y “Error al guardar”
  (cuota llena o storage bloqueado) con un toast.
- **Renombrar / mover hojas**: doble clic en el chip o menú contextual
  (“Renombrar hoja”, “Mover a la izquierda/derecha”). También duplicar/eliminar.
  Con 5+ hojas aparece **“Hojas (N)”**, un menú de desborde que las lista todas
  con su ocupación sin recorrer el carril.
- **Auto acomodar** reparte **todas** las copias de la biblioteca: llena la hoja
  activa y, si no entran, inserta a continuación tantas hojas nuevas como haga
  falta, clonando la configuración de la activa. El resumen dice
  `N imágenes · M hojas`.
- Agregar/duplicar/quitar/mover hoja y auto acomodar entran al historial
  (`Ctrl+Z` / `Ctrl+Y`).
- **Exportar…** abre un modal con una hoja por checkbox (las vacías quedan
  deshabilitadas) y permite elegir PDF, PNGs o Imprimir solo sobre las
  seleccionadas. Con varias hojas, PNGs se descarga como un único ZIP.
- El **zoom** solo actualiza el transform de la hoja; no reconstruye el rail,
  la galería ni las celdas.


---

## FontDetailSection — `/font/${id}`

Ruta con parámetro dinámico. Ojo: en Slice se escribe `${id}`, **no** `:id`.

| Propio | Rol |
|---|---|
| `Breadcrumbs` | Navegación de vuelta al catálogo |

| Compartido | También lo usa |
|---|---|
| `Button`, `Icon` | resto de la app |

**Servicios:** `FontsCatalog`, `ShareService`, `HtmlService` (escapa el texto
del usuario antes de meterlo en el SVG), `DownloadService`, `ToastProvider`.

---

## AboutSection — `/about`

Estática. Sin componentes ni servicios: solo HTML y CSS.

---

## NotFound — `/404`

No pasa por el `AppShell`: se monta como ruta propia, así que **no tiene
navbar**. Usa `Button` para volver al inicio.

---

## Componentes compartidos

Los que aparecen en varias vistas. Cambiarlos impacta en todas.

| Componente | Consumidores |
|---|---|
| `Button` | 11 — la pieza más transversal del proyecto |
| `Icon` | 7 |
| `Modal` | `CellSizeModal`, `ConfirmActionModal` |
| `Select` | CanvasSection, LayoutsPanel |
| `Tabs` | CanvasSection, DesignerSection |
| `Input` | CanvasSection, DesignerToolbar |

`ConfirmActionModal` es un caso aparte: **ninguna vista lo construye ni lo
referencia**. Lo monta `Providers` y escucha el evento `confirm:request`. Ver
[SERVICIOS.md](./SERVICIOS.md).

---

## Componentes sin uso

Están en el registro y en `components.js`, pero hoy no los construye nadie:

| Componente | Nota |
|---|---|
| `Card` | Del scaffold del framework. Es el más atrasado en estilos |
| `Checkbox` | Funcional, sin consumidores |
| `Loading` | El framework lo usa por su cuenta vía `loading.enabled` en la config |
| `Route` | Se usa `MultiRoute` en su lugar |
| `ThemeSelector` | Reemplazado por `ThemeSwitcher` |

No los borré porque el registro los expone y podrían hacer falta. Si se
descartan, hay que sacarlos también de `components.js`.
