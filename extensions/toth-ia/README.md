# @ohif/extension-toth-ia

«Medir IA»: un botón (y `Mayús + M`) que deja medido el índice acetabular de
una RX de pelvis pediátrica, como dos ángulos Cobb editables que el radiólogo
revisa y corrige. Si mueve un punto, el ángulo se recalcula solo. En una
telerradiografía de EEII (una placa al menos 1,8 veces más alta que ancha) el
mismo botón mide la pierna: ver «Pierna completa» más abajo.

## Cómo funciona

```
navegador ──/api/ia/caderas?client&studyUID&seriesUID&objectUID&filas&columnas&fotometria──▶ servidor del visor
servidor del visor ──/wado (JPEG, ≤1.536 columnas)──▶ relay ──▶ dicom-index del centro
servidor del visor ──POST JPEG──▶ ia-caderas (Supermicro, iaTunning/scripts/servicio_caderas.py)
                   ◀── 4 puntos en píxeles del DICOM, o 422 «no es una pelvis AP»
```

- El navegador no manda la imagen ni conoce el servicio: pide la medición al
  lado de `/wado` (la URL sale del `imageId` del manifiesto) y el servidor del
  visor (`toth/ia-caderas.mjs`) hace el resto. La ruta pasa por la misma
  compuerta que las imágenes (`toth/api-gate.mjs`): un enlace sólo mide su
  estudio, una sesión sólo su centro.
- El servicio recibe el JPEG que entrega dicom-index, igual que las RX con que
  se entrenó el modelo, e invierte las MONOCHROME1 que el WADO de un nodo
  antiguo entrega en negativo. No recibe UIDs ni datos del paciente, y no
  guarda nada.
- Si no es una pelvis AP, no dibuja: el servicio rechaza (422) cuando los mapas
  del modelo no se concentran en un punto o la geometría no calza. En 200 RX
  públicas rechazó 1; en recortes que imitan una placa equivocada (sólo
  fémures, media pelvis, rotada) rechazó casi todos. El radiólogo ve el motivo.
- Cada cadera es una herramienta **Cobb** (desde noviembre de 2026; antes,
  Ángulo de 3 puntos), dibujada como a mano (`cobbCaderas` en `medicion.ts`):
  - **Hilgenreiner**: una sola línea por los dos cartílagos trirradiados,
    prolongada hacia afuera de cada uno dos veces el largo de su techo. Cada
    Cobb lleva su copia y `hilgenreiner.ts` las mueve juntas: si el radiólogo
    corrige la línea, cambian los dos ángulos (y se guardan las dos
    correcciones).
  - **Techo**: del cartílago al borde acetabular. No comparte vértice con
    Hilgenreiner: el cartílago queda sobre ella, entre sus extremos, y cada
    punto se toma por separado.
  - El valor es exactamente el índice del modelo: Cobb junta las líneas por
    su par de extremos más cercanos, que es el de Hilgenreiner de ese lado con
    el borde del techo (las dos hacia afuera). Si Hilgenreiner terminara en
    los cartílagos, el par sería el cartílago y mostraría 180° menos el índice.
    Con la prolongación de dos techos eso sólo pasa si el radiólogo la acorta a
    menos de medio techo (un techo, con 60°). Lo comprueba `cobb.test.ts`
    contra el `_calculateCachedStats` de CobbAngleTool 5.6.12.
  - El texto va junto a cada cartílago (`textosCaderas`): sin eso Cobb lo
    pone en su punto de más a la derecha, el mismo extremo de Hilgenreiner
    para las dos caderas.
- Las etiquetas dicen de qué cadera del paciente es cada ángulo, leyendo
  `PatientOrientation` del archivo (en una AP habitual, `L\F`: la izquierda de
  la imagen es la cadera derecha).
- El ángulo es el de las líneas dibujadas, sin la calibración por centro: en
  csf da en promedio ~1,9° más que los informes (los radiólogos ponen el borde
  del techo en otro lugar). Las mediciones viven en la sesión, como las
  manuales: el data source `dicomjson` es de sólo lectura.
- Volver a apretar el botón sobre la misma imagen reemplaza los ángulos de la
  IA, no los suma; también los de Ángulo que hayan quedado de antes.

## Correcciones del radiólogo

Lo que el radiólogo corrige es lo que más sirve para entrenar: puntos de
experto sobre imágenes del centro. `src/correcciones.ts` las manda solas:

```
navegador ──POST /api/ia/caderas/correccion?<query de la medición>  {anotacion, cadera, mitad, modelo, puntos_ia, puntos}──▶ servidor del visor
servidor del visor ──POST JSON a la misma ruta /ia/caderas──▶ ia-caderas, que lo anota en el Supermicro
```

- Se guardan en la forma de siempre: los tres puntos [lateral sobre
  Hilgenreiner, cartílago, techo], con el índice en el del medio. El Cobb se
  convierte en el navegador (`tresDesdeCobb`): cartílago y techo son los
  extremos del techo, y el punto lateral queda en la dirección de Hilgenreiner
  que da el mismo ángulo que mostraba Cobb, a la distancia que le dio la IA.
  Así el servidor del visor y el servicio no cambiaron, y las filas viejas
  (de Ángulo) y las nuevas se leen igual. Lo único que no pasa es dónde quedó
  Hilgenreiner si se la corrió en paralelo, que no cambia el índice.
- Cornerstone avisa en cada paso del arrastre, así que cada ángulo se manda
  2 s después de su último movimiento (o al cerrar o cambiar de estudio, con
  `keepalive`), y sólo si algún punto se movió más de medio píxel desde lo
  último enviado. Deshacer también cuenta.
- El servicio anota cada envío; al entrenar vale el último de cada imagen y
  cadera (`iaTunning/scripts/correcciones_caderas.py`). Si el radiólogo lo
  devuelve a donde lo puso la IA, queda como confirmado.
- Sólo los ángulos que creó el botón: de uno dibujado a mano no se sabe qué
  mide. Borrar no se anota, porque cerrar el estudio también borra.
- Van los UID de la imagen (para volver a pedirla al entrenar), el centro y
  los puntos; nunca datos del paciente. Quedan en el Supermicro
  (`/mnt/data/ia/datasets/caderas-correcciones`). No se sabe qué radiólogo
  corrigió: el enlace no lo dice.
- El relay sólo tunela `/ia/caderas`, así que la corrección va por ahí mismo
  y el servicio la distingue por el content-type: no hizo falta tocar el relay.
- Si el envío falla, no se avisa al radiólogo: se reintenta con el próximo
  movimiento.

## Pierna completa

```
navegador ──/api/ia/pierna?<query de caderas>&mm=<PixelSpacing>──▶ servidor del visor (toth/ia-pierna.mjs)
servidor del visor ──/wado (JPEG, ≤2.048 columnas; 1.536 si pasa de 3 MB)──▶ relay ──▶ dicom-index
servidor del visor ──POST JPEG──▶ ia-pierna (Supermicro, iaTunning/scripts/servicio_pierna.py)
                   ◀── por pierna: 4 ángulos (3 puntos) y 2 largos (2 puntos), o el motivo para no medirla;
                       con las dos piernas, 2 desniveles (un punto por pierna)
```

- `medirIA` elige: si la imagen es alta (`esTelerradiografia`), `medirPierna`;
  si no, `medirIndiceAcetabular`. Los dos comandos siguen existiendo sueltos.
- Por pierna deja cuatro herramientas **Ángulo** y dos **Longitud**,
  rotuladas con la pierna del paciente (`PatientOrientation`, como las
  caderas):
  - **eje** = [cadera, rodilla, tobillo]. En la imagen se lee como lo informa
    el radiólogo: «Eje 3,0° varo» (180° menos el ángulo en la rodilla, varo si
    la rodilla queda por fuera de la línea cadera-tobillo). El panel de
    mediciones muestra el ángulo crudo (177°).
  - **mLDFA** y **MPTA**, con el vértice en el cruce de la línea articular del
    fémur (cóndilos) o de la tibia (platillo) con su eje mecánico: Ángulo
    muestra el valor exacto. Normal: 85–90°.
  - **eje anatómico** = [diáfisis del fémur a la altura de la cabeza, cruce
    con el eje de la tibia, tobillo], escrito como el mecánico («Eje
    anatómico 5,2° valgo»). La diáfisis la busca el servicio en la imagen
    (bordes de la cortical entre el 30 y el 80 % del fémur); la tibia va por
    su eje mecánico (rodilla → tobillo), como el FTA de BMPLE.
  - **fémur** (borde superior de la cabeza → medio de los cóndilos) y
    **tibia** (medio del platillo → centro del tobillo), con Longitud: «Fémur
    424 mm». El borde superior de la cabeza se estima a 5,5 % del largo
    cabeza → rodilla sobre su centro.
  - El texto lo pone `pierna.ts` (`textoPierna`) envolviendo el
    `getTextLines` de Ángulo y de Longitud en cada grupo; lo hecho a mano no
    cambia. Si el radiólogo mueve un punto, el texto se recalcula. Los mm son
    los que calibró Longitud (`cachedStats`), los mismos que mide a mano; sin
    el sufijo de calibración («mm Unknown»).
  - Cada medida se corrige por separado: mover la rodilla del eje no mueve
    el vértice del mLDFA.
- Con las dos piernas medidas, dos **desniveles**: una Longitud entre los
  bordes superiores de las cabezas femorales y otra entre los medios de los
  platillos tibiales. El texto es la diferencia de altura en la imagen y la
  pierna más alta, como lo informa csf: «Desnivel de cabezas femorales:
  derecha 4 mm más alta». Con los pies en el suelo, el de las cabezas es la
  diferencia de largo total y el de las tibias, la de la tibia (más el pie).
  Como con el eje, el panel de mediciones muestra el valor crudo de la
  herramienta: el largo de la línea entre las dos piernas, no el desnivel.
- Los recuadros de las medidas nuevas van donde no se encimen con los del eje
  y la rodilla (`dondeTexto`): los largos y el anatómico hacia afuera de cada
  pierna, los desniveles en la pelvis (bajo las cabezas) y bajo las rodillas.
- El servicio mide cada pierna por separado y no dibuja la que no ve con
  claridad (rodilla o tobillo poco nítidos, prótesis, una sola pierna) o cuya
  geometría no calza; el aviso dice cuál faltó y por qué. Si no ve ninguna,
  responde 422 y no dibuja nada.
- Validación del modelo (v3, iaTunning/investigacion-pierna-completa.md): eje
  a 0,77° del informe de csf en placas que no entrenaron; en las placas de
  prueba de BMPLE, mLDFA a 0,36° y MPTA a 0,67° del traumatólogo.
- Las correcciones van como las de caderas, con `{pierna, mitad, medida}` en
  vez de `{cadera, mitad}`, a `/api/ia/pierna/correccion`; el servicio las anota
  en `/mnt/data/ia/datasets/pierna-correcciones` del Supermicro. Los largos y
  desniveles mandan 2 puntos; un desnivel va con pierna y mitad `ambas`.

## Probar en local

```bash
# 1. El servicio en el Supermicro (GPU1): con la unidad de «Para producción», o a mano:
#    ssh toth@10.10.10.2 'cd ~/iaTunning/scripts; env CUDA_VISIBLE_DEVICES=1 ../envs/caderas/.venv/bin/python -m uvicorn servicio_caderas:app --host 0.0.0.0 --port 8096'
# 2. El proxy, con la clave del servicio (sin escribirla a disco):
IA_CADERAS_URL=http://10.10.10.2:8096/ia/caderas \
IA_CADERAS_TOKEN="$(ssh toth@10.10.10.2 head -1 .config/ia/api-keys)" \
IA_PIERNA_URL=http://10.10.10.2:8098/ia/pierna \
IA_PIERNA_TOKEN="$(ssh toth@10.10.10.2 head -1 .config/ia/api-keys)" \
RELAY_REQUEST_TOKEN=... node toth/relay-proxy.mjs
# 3. El visor
APP_CONFIG=config/toth.js pnpm dev
```

Sin datos de pacientes: `iaTunning/scripts/mac/indice_publico.py` hace de dicom-index con RX públicas
(AV-DDH, BMPLE) y su docstring trae los servicios en el Mac (puertos 8196 y 8198, correcciones a un archivo aparte) y
el proxy con `RELAY_BASE=http://localhost:3011`. Así se probó el Cobb el 2026-11-03.

Tests: `node --test toth/*.test.mjs` y `npx jest` en esta carpeta (`cobb.test.ts` carga Cornerstone).

## En producción

1. **Servicio** en el Supermicro (GPU1): `iaTunning/servicios/ia-caderas.service`
   e `ia-pierna.service` (puerto 8098).
2. **Túnel**: `POST /ia/caderas` en `dicom-relay/main.py`; el conector del
   Supermicro (`iaTunning/scripts/conector_relay.py`, `ConectorPorRuta`)
   manda esa ruta a `http://127.0.0.1:8096`. Igual `POST /ia/pierna` →
   `http://127.0.0.1:8098` (`UPSTREAM_RUTAS` en `ia-conector.service`).
3. **Servidor del visor** (Cloud Run, `toth/cloudbuild.yaml`):
   `IA_CADERAS_URL=$_RELAY_BASE/ia/caderas?client=$_IA_NODO` y
   `IA_CADERAS_TOKEN` desde Secret Manager; ídem `IA_PIERNA_URL` e
   `IA_PIERNA_TOKEN`. Sin ellas el botón avisa que la medición no está
   configurada.
