# E2E (Playwright)

Pruebas de la app real con el dev server de Slice. Verifican el flujo de usuario,
no solo la lógica: medidas exactas, exportación PDF/PNG y la hoja de impresión.

## Correr

```bash
# primera vez en una máquina nueva
pnpm test:e2e:install

# suite completa (levanta `slice dev --port 3101` sola)
pnpm test:e2e

# modo UI / depuración
pnpm test:e2e:ui
```

Si ya hay un server en `http://127.0.0.1:3101`, Playwright lo reutiliza. En CI
(`CI=1`) siempre levanta uno propio. El puerto se cambia en
`playwright.config.js`.

## Qué cubre

57 tests. Cada archivo:

| Archivo | Verifica |
| --- | --- |
| `measure.spec.js` | “Editar medidas” fija 2 cm exactos, editar una celda no deforma ni mueve las anteriores, el plan de exportación coincide en mm, el mínimo de 1,5 cm se respeta, “Ajustar celdas a la hoja” sale del modo exacto y una medida que no entra se escala. |
| `export.spec.js` | PDF con `MediaBox` de Carta (216×279 mm), imagen nativa y matriz `cm` en puntos (posición y tamaño); una página por hoja con contenido; PNG con proporción de página y escala de impresión; ZIP con varias hojas; iframe de impresión con `@page` real, varias hojas y nodos medidos en px ≡ mm; modal de exportación con selección de hojas; hojas vacías omitidas; `Ctrl+Shift+E/P` solo hoja activa; fallback raster; doble click no duplica la exportación. |
| `sheets-library.spec.js` | Rail de hojas con scroll/fades/acciones fijas y hoja activa visible; biblioteca paginada de a 12, vuelta a la página 1 al borrar, búsqueda por nombre y estado vacío; “Vaciar” reinicia a una hoja en blanco; menú de desborde con todas las hojas; imagen en espera asignada con click. |
| `persistence.spec.js` | Recarga de la sesión (pool, hojas, medidas, zoom, hoja activa), flush sincrónico en `pagehide`, lectura de la sesión vieja con la clave histórica tras migrar a StorageService, e indicador Guardado/Error de cuota; aviso proactivo de poco espacio en IndexedDB. |
| `auto-assign.spec.js` | 9 copias repartidas en 3 hojas con la misma configuración y un solo undo. |
| `shortcuts.spec.js` | `Delete`, `Ctrl+C` y `Ctrl+V` sobre la celda seleccionada; “Pegar aquí” en una celda vacía; navegación con flechas; `Shift+flechas` y `Ctrl+A`; reemplazar, rotar y voltear imagen; selección múltiple con fit/quitar en lote; slider de zoom por celda; click/drag del slider sin iniciar el pan; encuadre global compartido entre copias y persistido. |
| `dnd.spec.js` | Arrastrar de la biblioteca a una celda y swap celda ↔ celda. |
| `clipboard.spec.js` | Pegar una imagen desde el portapapeles la agrega a la biblioteca y la coloca. |
| `heic.spec.js` | Subir y pegar un HEIC/HEIF real: `heic2any` lo convierte a JPEG y la imagen se agrega/coloca. |
| `undo-config.spec.js` | Undo de papel, preset, plantilla y producto. |
| `splitter-zoom.spec.js` | Arrastre de splitter, doble clic de reset, zoom por botón y `Ctrl+wheel`, px ≡ mm y sin repintar rail/hoja al hacer zoom. |
| `settings.spec.js` | Fit, escala de imagen y papel A5/A4 vertical llegan a la exportación. |
| `confirmations.spec.js` | Limpiar hoja y eliminar una hoja con contenido: cancelar conserva, confirmar aplica. |
| `features.spec.js` | Renombrar/mover hojas, hoja inicial sin márgenes, medidas uniformes, bloqueo de proporción, grilla/márgenes personalizados, papel horizontal global y tamaños estándar de carnet/pasaporte. |

## Notas

- Cada test corre en un contexto limpio (localStorage/IndexedDB vacíos).
- `helpers.js` genera los PNG de prueba en memoria y parsea PDF/PNG: no hay
  fixtures binarios que mantener.
- `window.print` se neutraliza con `addInitScript`; la impresión se inspecciona
  en el iframe que crea `ExportService`, sin abrir el diálogo nativo.
