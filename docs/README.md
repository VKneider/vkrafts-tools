# VKRAFTS — Documentación

Papelería creativa: tres herramientas de diseño que corren enteras en el
navegador, sin backend. Construida con [Slice.js](https://slicejs.dev)
(`slicejs-web-framework` 4.0.2).

## Índice

| Documento | Qué contiene |
|---|---|
| [ARQUITECTURA.md](./ARQUITECTURA.md) | Cómo arranca la app, rutas, shell, composition root, estado y eventos |
| [VISTAS.md](./VISTAS.md) | Cada vista con sus componentes propios y los que comparte |
| [SERVICIOS.md](./SERVICIOS.md) | Los 16 servicios, quién los consume y qué contrato tienen |
| [DESIGN.md](./DESIGN.md) | El sistema visual: tokens, reglas y por qué de cada decisión |

## Mapa rápido

```
src/
├── App/index.js              punto de entrada (carga el runtime de Slice)
├── routes.js                 rutas → AppShell
├── sliceConfig.json          managers activos, tema por defecto, categorías
├── events/                   catálogos de eventos declarados
│   └── confirm.events.js
├── Components/
│   ├── components.js         registro (nombre → categoría)
│   ├── Providers/            composition root: levanta los singletons
│   ├── AppComponents/        las vistas + el shell
│   ├── Visual/               componentes de UI reutilizables
│   └── Service/              lógica sin DOM
└── public/
    ├── Themes/               Light.css, Dark.css, Slice.css (legacy)
    └── Styles/               sliceStyles.css (tipografía + primitivas)
```

## Los tres módulos

**Designer** (`/designer`) — Catálogo de fuentes con previsualización en vivo.
Se escribe un texto, se elige tipografía y ajustes, y se exporta en PNG o SVG
listo para cortar en vinilo.

**Canvas** (`/canvas`) — Lienzo libre sobre Fabric.js: formas, texto editable,
pincel, capas e historial de deshacer y rehacer.

**Plantillas** (`/layouts`) — El módulo más grande. Acomoda varias imágenes en
una hoja para imprimir a tamaño real: plantillas de grilla, tamaños de producto
con celdas de medida fija, drag & drop, auto-acomodo, múltiples hojas y
exportación a PNG, PDF e impresión directa.

## Correr el proyecto

```bash
pnpm install
pnpm dev        # servidor de desarrollo (puerto 3001)
pnpm test       # vitest
pnpm lint       # eslint
```

Los tests cubren los servicios puros (`PlacementService`, `SheetService`,
`PoolService`, `ExportService`). Las vistas no tienen cobertura automatizada;
ver la sección correspondiente en [ARQUITECTURA.md](./ARQUITECTURA.md).
