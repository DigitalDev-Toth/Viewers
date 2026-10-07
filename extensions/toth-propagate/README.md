# @ohif/extension-toth-propagate

El botón «Propagate» de Horos (y de OsiriX, de donde viene su código), sólo
para el ventaneo: lo que el radiólogo ventanea en una serie se aplica en vivo a
las demás series que muestra la ventana.

## Cómo se usa

| Botón «Propagar ventaneo» | Ventanear | Ventanear con Alt |
|---|---|---|
| apagado (de fábrica) | sólo esa serie | todas las que comparten ventaneo |
| encendido | todas las que comparten ventaneo | sólo esa serie |

El botón va en la barra, a continuación de la herramienta de ventaneo, y se
recuerda entre sesiones (`localStorage`, clave `toth.propagateWindowLevel`).
Horos lo trae encendido; acá arranca apagado, y Alt sirve para el uso puntual.

Alt + arrastrar con el botón izquierdo ventanea **con cualquier herramienta
elegida**, no sólo con la de ventaneo: la extensión le suma ese atajo a
`WindowLevel`, igual que la cruz tiene Mayús + botón izquierdo. Horos no usa
ninguna tecla para esto; lo de Alt es nuestro.

## Qué series comparten ventaneo

Las reglas de Horos (`-[ViewerController propagateSettingsToViewer:]`):

- la misma modalidad;
- nunca CR ni NM: en CR cada placa trae su propia exposición, y en NM las
  cuentas dependen de la adquisición. DX sí se propaga entre DX;
- las dos en gris o las dos en color;
- el mismo mapa de color;
- en PET, las dos en SUV o las dos sin convertir.

Quedan afuera los viewports con más de una serie (fusión PET-CT) y los que no
son planos (3D, video, lámina, ECG).

## Qué cuenta como «ventanear»

Sólo lo que hace el radiólogo: un cambio de ventaneo mientras tiene el botón
del mouse apretado (arrastrar, los controles deslizables del menú) o dentro del
mismo clic o tecla (un preset desde el menú o con su atajo). Por eso no se
propagan:

- el ventaneo de fábrica que trae una serie al cargarse en un viewport, que si
  no pisaría el que el radiólogo ya había puesto en las demás;
- los cortes que traen su propio ventaneo al recorrer la serie con la rueda;
- los cambios que llegan por comando sin gesto de por medio (por ejemplo, desde
  el RIS por `external-control`).

## Lo que no hace (todavía)

- **No cruza monitores.** Propaga entre los viewports de esta ventana; cada
  monitor del puesto es una ventana aparte. Horos sí lo hace, y el camino sería
  un `BroadcastChannel` entre las ventanas del visor, que son del mismo origen.
- **No propaga zoom, pan ni rotación**, que Horos sí propaga entre series
  paralelas del mismo estudio.
