# Sistema visual — Memphis 80s

Referencia del lenguaje visual de VKRAFTS. Leerla antes de tocar CSS. Ante la
duda, imitar lo que ya está en vez de inventar un patrón nuevo.

## El concepto

VKRAFTS es papelería creativa: stickers, fotos, cosas para imprimir y recortar.
Tiene que dar ganas de jugar, no parecer un dashboard corporativo.

La regla que ordena todo el sistema:

> **La personalidad viene de la FORMA y el COLOR, no del borde ni de la sombra.**

De ahí salen las tres prohibiciones:

1. **Nada de degradados decorativos.** Color plano. *Excepción:* los tableros de
   ajedrez que indican transparencia son funcionales, no decoración.
2. **Nada de sombras duras sin desenfoque** (`4px 4px 0 color`). Ese es el
   lenguaje "sticker book", que se descartó explícitamente.
3. **Nada de bordes gruesos de tinta** (2px+ de `--font-primary-color`). Mismo
   motivo.

Lo que sí: formas geométricas sueltas (triángulos, círculos, squiggles,
píldoras), tramas de puntos y rayas, composición asimétrica y bloques de color
plano.

## Tipografía

| Variable | Fuente | Uso |
|---|---|---|
| `--vk-font-display` | **Outfit** | `h1`–`h3`, wordmark, números grandes |
| `--vk-font-ui` | **Karla** | Todo lo demás: cuerpo, botones, inputs, etiquetas |
| `--font-family` | apunta a `--vk-font-ui` | La consumen los componentes Visual del framework |

Son deliberadamente limpias: si la letra también fuera ruidosa competiría con
las formas.

`--font-family` es la palanca global — la usan `Input`, `Select`, `Navbar`,
`Card`, `Checkbox`, `DropDown`, `Breadcrumbs` y `NotFound`, así que cambiarla
alinea toda la app sin tocarlos uno por uno.

> Los `<button>` e `<input>` **no heredan** `font-family`: cada navegador les
> impone la suya. Por eso `sliceStyles.css` tiene una regla explícita. No se
> hereda `font-size` a propósito, porque varios controles dependen del tamaño
> por defecto del navegador.

## Color

Los tokens viven en `public/Themes/Light.css` y `Dark.css`. **Los dos temas se
actualizan juntos**: nunca agregar un color que exista en uno solo.

| Token | Rol |
|---|---|
| `--primary-color` | Teal (verde azulado). Acciones principales, estado activo |
| `--secondary-color` | Rosa Memphis. **Relleno, nunca texto** |
| `--accent-color` | Amarillo limón. **Decorativo, solo relleno** |
| `--accent-text-color` | El acento cuando tiene que leerse. Magenta en Light |
| `--accent-contrast` | La tinta que va encima del amarillo |
| `--success/warning/danger-color` | Semánticos, con su `-contrast` |
| `--medium-color` | Texto secundario |
| `--paper-color` | Papel de las previsualizaciones. **Blanco puro en Light** |

### Tres cosas que es fácil hacer mal

**El rosa y el amarillo no son colores de texto.** En Light dan 2,39:1 y no
llegan ni al umbral de texto grande. Sirven de relleno con `-contrast` encima.
Para el acento como tinta está `--accent-text-color`.

**En Dark los `-contrast` son OSCUROS.** Ahí los colores de estado son claros, así
que la tinta que va encima es casi negra, no blanca. Poner blanco da 1,2:1.

**El verde de éxito está oscurecido a propósito.** Con un verde más claro quedaba
con la misma luminancia que el teal primario: se distinguían por matiz pero no
por claridad, o sea eran el mismo color en escala de grises y para daltonismo.

### Verificar contraste al cambiar un token

Todo valor está anotado con su ratio en el propio archivo de tema. Si se toca un
color, hay que recalcular: contra el fondo, contra la superficie elevada
(`--secondary-background-color`, que es más clara y baja el ratio) y contra su
`-contrast`. Mínimo AA (4,5:1) para texto normal.

## Forma

| Token | Valor | Uso |
|---|---|---|
| `--vk-radius` | 14px | Controles, chips, menús, celdas |
| `--vk-radius-lg` | 22px | Cards, paneles, modales |
| `--border-radius-slice` | 10px | Lo consumen los componentes del framework |

Los botones van en **píldora** (`999px`), no en `--vk-radius`: son formas limpias
y rotundas, que es lo que pide el lenguaje.

## Superficies

Una superficie elevada es un **bloque plano**: fondo propio, radio grande y sin
contorno. Nada de hairline de 1px alrededor — eso es convención de "card" y acá
la superficie se distingue por su fondo.

```css
background: var(--secondary-background-color);
border-radius: var(--vk-radius-lg);
box-shadow: var(--box-shadow-primary);
```

**Excepción:** los elementos densos y repetidos (chips, ítems de menú, el control
de cantidad) sí llevan hairline fino. La regla general:

> El tratamiento fuerte —color pleno, trama, sombra— va en los elementos que
> aparecen **unas pocas veces por pantalla**. Nunca en los que se repiten
> decenas de veces: ochenta celdas cada una con su trama es ruido, no
> personalidad.

Por eso el panel de Plantillas es sobrio y el color aparece solo en los estados
activos, mientras que el Hub y los modales se bancan bloques de color fuerte.

## Tramas

```css
color: var(--secondary-color);          /* la trama usa currentColor */
background-image: var(--vk-dots);
background-size: var(--vk-dots-size);
```

`--vk-stripes` funciona igual. Se usan para confirmar un estado interactivo
—celda vacía en hover, zona de drop activa, tiradores de resize— y como textura
de fondo en bloques grandes.

## Movimiento

`--vk-bounce` es la curva del sistema: `cubic-bezier(0.34, 1.56, 0.64, 1)`, con
sobrepaso.

Duraciones entre **150 y 300 ms** para feedback de controles. Más lento se
siente pegajoso — el `transition-duration: 0.4s` que traía `Button` era el doble
del techo.

Preferir `translate`, `scale` y `rotate` como propiedades independientes en vez
de `transform`: no se pisan entre sí y se animan por separado.

Todo bloque de animación decorativa se apaga bajo
`@media (prefers-reduced-motion: reduce)`.

## Trampas conocidas

**Variables que no existen.** El fallo más caro y el más invisible: una regla
como `var(--border-color, #d1d5db)` parece correcta, pero si el token no existe
cae siempre al valor fijo y el componente ignora el tema. Antes de usar un
`var(--x)` hay que confirmar que `--x` esté definido en **los dos** temas.

**`rgba(var(--x-color), 0.5)` es CSS inválido.** Solo los tokens terminados en
`-rgb` son tripletes. Para el resto va `color-mix(in srgb, var(--x-color) 50%,
transparent)`.

**`prefers-color-scheme` no es el tema de la app.** Es el del sistema operativo.
El tema lo marca el atributo `data-slice-theme` que pone el themeManager.

**El papel no sigue al tema.** La hoja de Plantillas es `#ffffff` fijo y las
previsualizaciones usan `--paper-color`: representan el producto impreso, no
chrome de la interfaz. Lo mismo vale para el scrim oscuro sobre las fotos y los
tableros de transparencia.

## Temas

`Light.css` y `Dark.css` están al día y tienen los mismos 28 tokens.

`Slice.css` es el tema del scaffold original (uva y lima), ajeno a este sistema.
Hoy no se alcanza desde la UI —`ThemeSwitcher` solo cicla Light y Dark— pero
sigue en `/Themes` y el themeManager podría cargarlo, así que se le mantienen
los tokens al día para que no rompa. **Conviene borrarlo.**
