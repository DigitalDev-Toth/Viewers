# @ohif/extension-toth-ia

«Medir IA»: un botón (y `Mayús + M`) que deja medido el índice acetabular de
una RX de pelvis pediátrica, como dos ángulos editables que el radiólogo revisa
y corrige. Si mueve un punto, el ángulo se recalcula solo.

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
- Cada cadera es una herramienta **Ángulo** con los puntos [lateral sobre
  Hilgenreiner, cartílago trirradiado, techo]: Ángulo mide en el punto del
  medio, así que muestra el índice acetabular exacto del modelo. Cobb no sirve:
  reordena los segmentos por los extremos más cercanos y, con el vértice
  compartido, mediría 180° menos el índice.
- Las etiquetas dicen de qué cadera del paciente es cada ángulo, leyendo
  `PatientOrientation` del archivo (en una AP habitual, `L\F`: la izquierda de
  la imagen es la cadera derecha).
- El ángulo es el de las líneas dibujadas, sin la calibración por centro: en
  csf da en promedio ~1,9° más que los informes (los radiólogos ponen el borde
  del techo en otro lugar). Las mediciones viven en la sesión, como las
  manuales: el data source `dicomjson` es de sólo lectura.
- Volver a apretar el botón sobre la misma imagen reemplaza los ángulos de la
  IA, no los suma.

## Correcciones del radiólogo

Lo que el radiólogo corrige es lo que más sirve para entrenar: puntos de
experto sobre imágenes del centro. `src/correcciones.ts` las manda solas:

```
navegador ──POST /api/ia/caderas/correccion?<query de la medición>  {anotacion, cadera, mitad, modelo, puntos_ia, puntos}──▶ servidor del visor
servidor del visor ──POST JSON a la misma ruta /ia/caderas──▶ ia-caderas, que lo anota en el Supermicro
```

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

## Probar en local

```bash
# 1. El servicio en el Supermicro (GPU1): con la unidad de «Para producción», o a mano:
#    ssh toth@10.10.10.2 'cd ~/iaTunning/scripts; env CUDA_VISIBLE_DEVICES=1 ../envs/caderas/.venv/bin/python -m uvicorn servicio_caderas:app --host 0.0.0.0 --port 8096'
# 2. El proxy, con la clave del servicio (sin escribirla a disco):
IA_CADERAS_URL=http://10.10.10.2:8096/ia/caderas \
IA_CADERAS_TOKEN="$(ssh toth@10.10.10.2 head -1 .config/ia/api-keys)" \
RELAY_REQUEST_TOKEN=... node toth/relay-proxy.mjs
# 3. El visor
APP_CONFIG=config/toth.js pnpm dev
```

Tests: `node --test toth/*.test.mjs` y `npx jest` en esta carpeta.

## En producción

1. **Servicio** en el Supermicro (GPU1): `iaTunning/servicios/ia-caderas.service`.
2. **Túnel**: `POST /ia/caderas` en `dicom-relay/main.py`; el conector del
   Supermicro (`iaTunning/scripts/conector_relay.py`, `ConectorPorRuta`)
   manda esa ruta a `http://127.0.0.1:8096`.
3. **Servidor del visor** (Cloud Run, `toth/cloudbuild.yaml`):
   `IA_CADERAS_URL=$_RELAY_BASE/ia/caderas?client=$_IA_NODO` y
   `IA_CADERAS_TOKEN` desde Secret Manager. Sin `IA_CADERAS_URL` el botón
   avisa que la medición no está configurada.
