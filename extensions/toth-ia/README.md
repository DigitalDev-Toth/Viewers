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

## Para producción (pendiente)

1. **Unidad systemd** en el Supermicro: `iaTunning/servicios/ia-caderas.service`
   (`systemctl --user link … && systemctl --user enable --now ia-caderas`).
2. **Túnel**: el relay declara cada ruta `/ia/*` por separado; falta
   `POST /ia/caderas` en `dicom-relay/main.py` (como `/ia/transcribir`, con
   `forward_content_length` y un tope de tamaño). El conector del Supermicro
   (`iaTunning/scripts/conector_relay.py`) reenvía todo a un solo `UPSTREAM`
   (Parakeet, 8095): hace falta un segundo conector con otro nombre de nodo
   hacia `http://127.0.0.1:8096`, o repartir por ruta.
3. **Servidor del visor** (Cloud Run): `IA_CADERAS_URL=https://relay.cui.date/ia/caderas?client=<nodo>`
   y `IA_CADERAS_TOKEN` desde Secret Manager. Sin `IA_CADERAS_URL` el botón
   avisa que la medición no está configurada.
