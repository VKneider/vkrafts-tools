# Plantillas de Hoja — Reporte de cobertura y brechas

Fecha: 2026-11-08
Módulo: `src/Components/AppComponents/LayoutsSection` y servicios asociados
Alcance: vista de plantilla, edición de medidas, biblioteca, hojas, exportación e impresión.

## 1. Resumen ejecutivo

Los E2E actuales cubren el camino crítico: medidas exactas, PDF/PNG con tamaño
real, impresión, rail de hojas, paginación y búsqueda de la biblioteca, zoom por
celda con rueda y slider, selección múltiple y confirmaciones destructivas
(57 tests, todos verdes).

Prioridad acordada:

1. **E2E** de persistencia, auto-acomodo multi-hoja, atajos/undo, splitter y zoom.
2. **Bugs/deudas**: atajos que ignoran la celda seleccionada, undo incompleto,
   flush al cerrar pestaña y copy de medidas poco claro.
3. **Features**: renombrar/reordenar hojas, medidas uniformes con bloqueo de
   proporción y tamaños estándar de producto.

## 2. Cobertura E2E actual

57 tests en 14 archivos (`pnpm test:e2e`, ~5 min).

| Archivo | Qué prueba |
| --- | --- |
| `measure.spec.js` | 2 cm exactos, independencia entre celdas, plan de exportación en mm, mínimo de 1,5 cm, “Ajustar celdas a la hoja” y medidas que no entran (se escalan). |
| `export.spec.js` | MediaBox de Carta, imagen nativa, matriz `cm` en puntos (posición y tamaño), una página por hoja; PNG a escala 3; ZIP con varias hojas; `@page` real, varias hojas y px ≡ mm en impresión; modal de exportación con selección de hojas y PDF/PNGs; **hojas vacías omitidas** en PDF/PNG/impresión; `Ctrl+Shift+E/P` solo hoja activa; **fallback raster** cuando no se puede leer ninguna imagen; **doble click** no dispara dos exportaciones. |
| `sheets-library.spec.js` | Rail con scroll/fades/acciones fijas; paginación de a 12 con salto a la última página y vuelta a la 1 al borrar; búsqueda por nombre con estado vacío; **Vaciar** reinicia la planilla a una sola hoja en blanco; **menú de desborde** con todas las hojas; imagen en espera asignada con click. |
| `persistence.spec.js` | Recarga con pool, hojas, medidas, zoom y hoja activa; flush sincrónico en `pagehide`; lectura de la sesión vieja (`vkrafts:sheet-layout`) tras migrar a StorageService; indicador Guardado/Error de cuota; aviso proactivo “Poco espacio” con `navigator.storage.estimate()`. |
| `auto-assign.spec.js` | 9 copias en 3 hojas con la misma configuración + un solo undo. |
| `shortcuts.spec.js` | `Ctrl+C/V` y `Delete` sobre la celda seleccionada; “Pegar aquí” en celda vacía; navegación por teclado; **Shift+flechas y Ctrl+A**; reemplazar imagen; rotar/voltear; selección múltiple con fit/quitar en lote; slider de zoom por celda; **click/drag del slider sin iniciar el pan**; **encuadre global compartido entre copias y persistido**. |
| `dnd.spec.js` | Arrastrar una imagen de la biblioteca a una celda y swap celda ↔ celda. |
| `clipboard.spec.js` | Pegar una imagen desde el portapapeles la agrega a la biblioteca y la coloca. |
| `heic.spec.js` | Subir y pegar un **HEIC/HEIF** real: `heic2any` lo convierte a JPEG y la imagen se agrega/coloca. |
| `undo-config.spec.js` | Undo de papel, preset, plantilla y producto. |
| `splitter-zoom.spec.js` | Arrastre de splitter, doble clic de reset, zoom por botón y `Ctrl+wheel`, invariante px ≡ mm y **sin repintar rail/hoja** al hacer zoom. |
| `settings.spec.js` | Fit, escala de imagen y papel A5/A4 vertical llegan a la exportación. |
| `confirmations.spec.js` | Limpiar hoja y eliminar una hoja con contenido: cancelar conserva, confirmar aplica. |
| `features.spec.js` | Renombrar/mover hojas, **hoja inicial sin márgenes**, medidas uniformes, bloqueo de proporción, grilla/márgenes personalizados, papel horizontal global y tamaños estándar de carnet/pasaporte. |

Comando: `pnpm test:e2e` (levanta `slice dev --port 3101`). Ver `tests/e2e/README.md`.

## 3. Cobertura E2E restante

**P0/P1 cubiertos**: persistencia, auto-acomodo multi-hoja, undo/redo,
splitters, zoom (slider y rueda), crop global, atajos con selección, Shift+rangos,
confirmaciones destructivas, fit/escala, paginación de ida y vuelta, exportación
(hojas vacías, solo activa, fallback raster y doble click), medidas límite,
drag & drop, portapapeles, rotar/voltear y accesibilidad de la grilla.

### P2 — difícil o de menor retorno

Sin pendientes funcionales ni de cobertura dentro del alcance actual.

## 4. Bugs y deudas detectadas

| Severidad | Problema | Detalle | Estado |
| --- | --- | --- | --- |
| Alta | `Delete`, `Ctrl+C` y `Ctrl+V` ignoraban la celda seleccionada | Usaban la primera celda con imagen / el primer hueco. | **Corregido**: operan sobre `_selectedSlot`; celda vacía ofrece “Pegar aquí”. |
| Alta | Undo incompleto | Papel, plantilla, preset, producto, fit y escala no llamaban a `_pushHistory`; plantilla/producto podían borrar placements sin undo. | **Corregido**: snapshot en cada configuración, uno por gesto del slider. |
| Media | Sin flush al cerrar pestaña | Debounce de 600 ms solo cubierto por `beforeDestroy`. | **Corregido**: `pagehide` + `visibilitychange` hacen `flush` sincrónico. |
| Media | Copy de medidas poco claro | El modal decía “Celda” pero afecta a columna/fila. | **Corregido**: labels “Ancho de columna / Alto de fila” + nota. |
| Media | Doble clic del splitter no reseteaba | `preventDefault()` en `pointerdown` suprimía el `dblclick`, y el commit sin movimiento reemplazaba el handle entre clicks. | **Corregido**: sin `preventDefault`, commit solo si cambió, selección de texto bloqueada durante el arrastre. |
| Media | El zoom repintaba toda la vista | `ctx.patch({ zoom })` disparaba `renderAll()`: reconstruía rail, galería y hoja en cada paso del wheel. | **Corregido**: el watcher detecta “solo zoom” y aplica el transform con `_applyZoom()`. |
| Baja (limitación) | Impresión con tamaños mixtos | `printSheets` usaba el `@page` de la primera hoja. | **Resuelto**: el papel es global (`setPageForAll`); todas las hojas comparten tamaño y orientación. |

## 5. Features faltantes en el módulo

### Implementadas en este pase

1. **Renombrar / reordenar / mover hojas**: doble clic o menú contextual
   (“Renombrar hoja”, “Mover a la izquierda/derecha”); `SheetService` expone
   `renameSheet`/`moveSheet`.
2. **Medidas uniformes**: “Aplicar a todas las celdas” y **bloquear proporción**
   en el modal de medidas.
3. **Papel global + orientación**: todas las hojas comparten `pageId`; se
   agregaron variantes horizontales de A4/Carta/A5 y el PDF pasa la
   `orientation` a jsPDF. El tamaño de hoja se elige **solo con el Select** (se
   quitaron los inputs de ancho/alto y el flujo de página personalizada).
4. **Grilla y márgenes personalizados**: columnas/filas (1–12) y margen/separación
   en cm; se rehidratan desde el id después de recargar. La vista inicial usa
   **Sin margen** (0 mm) por defecto.
5. **Indicador de guardado**: `SheetStorage` emite `sheet:save`
   (`saving`/`saved`/`error`); la vista muestra Guardando/Guardado y un error
   persistente con toast si la cuota está llena.
6. **Búsqueda en biblioteca**: filtra por nombre, muestra “N/M” y un estado
   vacío; la paginación se recalcula sobre el filtro.
7. **Exportar con selección**: modal “Exportar…” con checkboxes por hoja (las
   vacías quedan deshabilitadas), formatos PDF/PNGs/Imprimir solo sobre las
   elegidas; con varias hojas, PNGs se descarga como un único ZIP.
8. **Zoom por celda con rueda o Slider**: cada imagen tiene un `Slider` de Slice
   (100–300 %) superpuesto, visible al pasar el mouse o seleccionar la celda;
   además se conserva la rueda, el arrastre para encuadrar y el doble clic para
   resetear. El overlay tiene pista/pulgar más grandes y corta pointerdown/click
   para que no inicie el pan ni el drag&drop de la celda. **El zoom/encuadre
   vive en el asset**: todas las copias de la misma imagen comparten el crop en
   todas las hojas y se persiste en IndexedDB. El PDF rasteriza la vista
   recortada para respetar el encuadre.
9. **Tamaños estándar de producto**: además de fotos, stickers y credenciales,
   se agregaron **Carnet 3×4, Carnet 4×4, Carnet 2,5×3,5 y Pasaporte 3,5×4,5**
   (medidas reales en mm).
10. **Vaciar reinicia la planilla**: “Vaciar” elimina la biblioteca y deja una
    sola hoja en blanco conservando la configuración de la hoja activa.
11. **Selección múltiple de celdas**: `Ctrl/Cmd` alterna y `Shift` selecciona
    rangos; el menú contextual permite ajustar (cubrir/contener) y quitar en
    lote.
12. **Reemplazar imagen y accesibilidad**: “Reemplazar imagen…” reutiliza el
    selector oculto; las celdas son enfocables (`role=button`, `aria-label`,
    `aria-pressed`), se navegan con flechas/Home/End y Enter/Espacio activa.
13. **Se quitó la hoja de calibración** de la barra de acciones (el método de
    `ExportService` y su unit test se conservan por compatibilidad).
14. **Menú de desborde de hojas**: con 5+ hojas aparece “Hojas (N)” y lista
    todas con su ocupación (`1/4`, `2/4`) sin recorrer el carril.
15. **Selección por teclado**: `Shift+flechas` extiende el rango y `Ctrl/Cmd+A`
    selecciona todas las celdas de la hoja activa.
16. **Cobertura de rotar/voltear, drag & drop y portapapeles**: rotar 90° y
    voltear desde el menú contextual; arrastrar de la biblioteca a una celda;
    swap celda ↔ celda; pegar una imagen desde el portapapeles.

### StorageService (evaluación e integración)

`LocalStorageManager` está marcado como **deprecado** por Slice. Se migró
`SheetStorage` a `StorageService` con `namespace: 'vkrafts'` y key
`sheet-layout`, que produce `vkrafts:sheet-layout` (la misma clave histórica):
no hay migración de datos ni pérdida de sesiones. Los blobs siguen en
`IndexedDbManager`, ahora con su **API actual**: conexión única, `stores`
declarativos y `store('pool')` para `get/put/getAll/delete/clear`. La API vieja
queda como compatibilidad deprecada. La API nueva de `StorageService` aporta
namespace, `ttl`, `watch()` y fallback a memoria; el debounce/flush sigue en
`SheetStorage`.

Además, `saveAsset()` consulta `navigator.storage.estimate()` y emite
`sheet:save` con estado `warning` cuando la cuota de IndexedDB está al 85% o
más, antes de que la escritura falle. La vista muestra “Poco espacio” con un
toast. Hay unit test de `SheetStorage`, de la migración de API y del aviso de
cuota, más un E2E que lee una sesión vieja.

### Siguiente nivel

No quedan pendientes funcionales ni de cobertura dentro del alcance acordado.
El siguiente paso sería mantenimiento normal: nuevas plantillas/productos o
mejoras de rendimiento con muchas hojas.

## 6. Plan de ejecución (orden acordado)

### Fase 1 — E2E (antes de tocar código)

- [x] `persistence.spec.js`: recarga con pool, hojas, medidas, zoom y hoja activa.
- [x] `auto-assign.spec.js`: 9 imágenes, 3 hojas, cantidad y undo.
- [x] `shortcuts.spec.js`: `Delete`/`Ctrl+C`/`Ctrl+V` sobre celda seleccionada.
- [x] `undo-config.spec.js`: undo de papel, plantilla, preset y producto.
- [x] `splitter-zoom.spec.js`: arrastre de límite, doble clic y zoom.

Criterio: los tests nuevos fallan solo donde hay bugs conocidos y pasan el resto.

### Fase 2 — Bugs

- [x] Atajos de selección: borrar/copiar/pegar sobre `_selectedSlot`.
- [x] Undo de configuración: `_pushHistory` en papel, plantilla, preset, producto,
      fit y escala (una entrada por gesto del slider).
- [x] Flush en `pagehide`/`visibilitychange` desde `SheetStorage`.
- [x] Modal de medidas: aclarar “columna/fila”.
- [x] Doble clic del splitter (bonus detectado por el E2E).
- [x] Tests E2E de la fase 1 en verde.

### Fase 3 — Features

- [x] **Renombrar** (doble clic o menú) y **mover** hojas (menú).
- [x] **Aplicar a todas las celdas** + **bloquear proporción** en medidas.
- [x] **Papel global** + orientación horizontal, solo por Select.
- [x] **Grilla y márgenes personalizados**.
- [x] **Zoom por celda con Slider** además de rueda/arrastre/doble clic.
- [x] **Crop global por asset**, compartido entre copias y persistido.
- [x] **Tamaños de carnet y pasaporte** en productos.
- [x] **Vaciar** reinicia a una hoja en blanco.
- [x] **Selección múltiple**, reemplazar imagen y accesibilidad de celdas.
- [x] **Menú de desborde “Hojas (N)”** para muchas hojas.
- [x] **Shift+flechas** y **Ctrl/Cmd+A** para seleccionar celdas.
- [x] E2E de **drag & drop**, **portapapeles**, **rotar/voltear** y **fallback raster**.
- [x] **Exportación**: hojas vacías omitidas y `Ctrl+Shift+E/P` solo hoja activa
      (se corrigió `key` en mayúscula con Shift).
- [x] Se quitó la **hoja de calibración** y el **tamaño de página personalizado**.
- [x] `IndexedDbManager` actualizado a su API nueva (`stores`, `store(name)`,
      transacciones) para los blobs.
- [x] Aviso proactivo de **poco espacio** en IndexedDB (85% de la cuota).
- [x] E2E de renombrado/reordenamiento, medidas uniformes, grilla/márgenes,
      papel horizontal, carnet, slider, confirmaciones, atajos y persistencia.
- [x] Migración de `LocalStorageManager` a `StorageService` (namespace `vkrafts`,
      misma clave histórica).

## 7. Cómo correr

```bash
pnpm test          # unitarios (Vitest)
pnpm test:e2e      # E2E (Playwright; levanta el server en 3101)
pnpm test:e2e:ui
pnpm lint
pnpm build
```

## 8. Estado de implementación

- [x] Fase 1 completada — 5 archivos E2E nuevos (7 tests).
- [x] Fase 2 completada — atajos, undo, `pagehide`, labels, splitter y zoom sin repintar toda la vista.
- [x] Fase 3 completada — hojas renombrables/movibles, medidas uniformes,
      papel global/orientación, grilla/márgenes, exportación con selección +
      ZIP, slider de zoom por celda, crop global, tamaños de carnet, selección
      múltiple, menú de desborde, reemplazo de imagen y accesibilidad.
- [x] Guardado visible (`saving`/`saved`/`error`) y búsqueda de biblioteca.
- [x] `StorageService` integrado en `SheetStorage` (namespace `vkrafts`, misma
      clave histórica) y `IndexedDbManager` con su API actual, con unit tests y
      E2E de sesión vieja.
- [x] Suite completa en verde: **57 E2E**, **116 unitarios**, lint y build.
