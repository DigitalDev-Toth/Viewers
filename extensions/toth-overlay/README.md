# @ohif/extension-toth-overlay

Los datos del paciente y del estudio en cada cuadro, a la manera de Horos.

## Por qué

En el puesto de diagnóstico el RIS encola varios pacientes en el mismo visor,
y el visor son dos o tres ventanas. OHIF pone el paciente sólo en la cabecera
de cada ventana, y la cabecera de una no dice nada de lo que muestra la de al
lado. El radiólogo mira la imagen, no la cabecera: cada imagen tiene que decir
de quién es.

## Qué muestra

| Esquina | Línea | De dónde |
|---|---|---|
| arriba a la izquierda | Nombre del paciente | manifiesto |
| | ID · sexo · nacimiento (edad al estudio) | manifiesto; nacimiento y `PatientAge` del archivo |
| | Institución | archivo |
| arriba a la derecha | Lateralidad · proyección (`R · CC`) | manifiesto |
| | Fecha y hora del estudio | fecha del manifiesto, hora del archivo |
| | Descripción del estudio | manifiesto |
| | `Acc.` número de acceso, el de la orden en el RIS | manifiesto |
| | `Serie` número · descripción | manifiesto |

Abajo queda lo de OHIF: ventana/nivel, zoom e instancia.

El reparto sigue la plantilla de Horos (`Horos/Resources/AnnotationsDefault.plist`):
paciente y estudio arriba. La lateralidad se toma como la toma Horos
(`DCMPix.m`): `ImageLaterality`, y si la imagen no la trae, la `Laterality`
de la serie. Horos la dibuja arriba al centro; OHIF no tiene esa posición, así
que va primera arriba a la derecha.

La edad es la del día del estudio, calculada con el nacimiento y la fecha del
estudio. Si falta alguno, se usa `PatientAge` tal como lo escribió el equipo.
Debajo de dos años va en meses y debajo de un mes en días.

## De dónde salen los datos

Lo que trae el manifiesto de dicom-index manda: el índice ya limpió los
nombres. El manifiesto no trae el nacimiento, la hora ni la institución, y
sumarlos significa actualizar el conector de cada centro. Pero el visor baja
cada imagen como DICOM completo y el cargador de Cornerstone guarda el archivo
parseado, así que esos datos se leen de ahí, sin pedir nada a la red.

Mientras la imagen no termina de bajar, el cuadro muestra lo del manifiesto y
se completa al redibujarse. El texto se decodifica como UTF-8 y, si no lo es,
como Latin-1, porque los equipos no siempre declaran bien su juego de
caracteres.

## Pruebas

```bash
cd extensions/toth-overlay && npx jest
```
