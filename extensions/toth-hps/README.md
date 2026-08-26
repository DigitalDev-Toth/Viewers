# @ohif/extension-toth-hps

Los colgados del puesto de diagnóstico de Toth: dos o tres monitores, el visor
abierto toda la jornada, y el reparto de las series entre las pantallas.

Vive aparte de `@ohif/extension-external-control` a propósito. Esa se mantiene
libre de todo lo nuestro para poder ofrecerla upstream; ésta es lo contrario:
decisiones de nuestro puesto, que no tienen por qué servirle a nadie más.

## `@toth/secondScreen`

Lo que el primer monitor no está mostrando. El monitor principal abre con el
colgado que OHIF elija —tiene reglas por modalidad, y sabe más que nosotros—,
y el segundo toma las series **desde la segunda en adelante**:

| Series en el estudio | Monitor 1 | Monitor 2 |
|---|---|---|
| 2 (una radiografía de dos vistas) | la primera, 1x1 | la segunda, 1x1 |
| 5 (un TC con varias series) | la primera | las otras cuatro, en 2x2 |
| 1 | la única | vacío |

El monitor 2 vacío cuando no hay una segunda serie es deliberado: mostrar la
misma imagen dos veces ocupa una pantalla de diagnóstico sin agregar nada. Si
alguna vez se prefiere lo contrario, es cambiar el `matchedDisplaySetsIndex`
de la última etapa.

Nada de esto distingue todavía por modalidad. Cuando haga falta —una mamografía
no se cuelga como un TC— el lugar es este mismo módulo.
