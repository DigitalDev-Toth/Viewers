# Migración del fork Toth: OHIF Meteor (2018) → OHIF v3

Todo lo propio vive bajo `toth/` para no chocar con archivos de upstream y
poder seguir haciendo `git fetch upstream` sin conflictos.

## De dónde venimos

| | |
|---|---|
| Estado anterior | tag `fork-meteor-2018`, rama `legacy-meteor` (HEAD `4b26027089`, 5 oct 2018) |
| Merge-base con upstream | `18a3bcba30` (21 sep 2018) |
| Distancia | 5.734 commits |

El fork estaba en OHIF Meteor (v1: Blaze + paquetes `ohif:*`). Upstream es
OHIF v3 (monorepo React + `extensions/` + `modes/` + Cornerstone3D). No hay
archivos en común, así que no hubo merge: se creó `v3` desde
`upstream/master` y las customizaciones se reponen a mano. El código viejo
queda íntegro en el tag y la rama legacy.

## Las 6 customizaciones y su destino en v3

| # | Qué era | Dónde estaba | Destino en v3 |
|---|---|---|---|
| 1 | i18n `tap:i18n` + `es.i18n.json` + `TAPi18n.__()` en ~30 labels | `StandaloneViewer/i18n/`, `toolbarSection.js` | **Se descarta.** v3 trae i18next con locale `es` completo de fábrica. |
| 2 | Branding: header comentado, logo cui.date | `standaloneViewer.html`, `headerItems.js` | Configuración (`whiteLabeling` en el config del visor), no código. |
| 3 | Token en la ruta `/:id` → resuelve AE Title | `routes.js:20-48` | **Lógica de negocio propia.** Hoy la resuelve el relay: el `client` va en la query y el token es un JWT (`scope=list`/`download`). |
| 4 | Cliente dcm4chee: QIDO/WADO → JSON de estudio | `service/nodes.js` (350 líneas) | **Reemplazado por dicom-index.** `GET /study/{iuid}` ya devuelve study/series/instances. |
| 5 | Orden de series (`reverse()` + quicksort por `seriesNumber`) | `nodes.js:194-249` | **Se descarta.** Era un parche a un bug de v1; v3 ordena por `InstanceNumber` / `ImagePositionPatient`. |
| 6 | URLs WADO-URI con `contentType=application/dicom&transferSyntax=*` | `nodes.js:68-81` | **Sobrevive tal cual.** Es exactamente lo que arma `buildInstanceWadoUrl` en `extensions/default/src/DicomWebDataSource/utils/getImageId.js`. |

O sea: de 507 líneas, lo único irreemplazable era el paso token→estudio, y
esa responsabilidad ya se movió al relay.

## Integración con dicom-index / dicom-relay

v3 trae `extensions/default/src/DicomJSONDataSource`, que consume un JSON con
esta forma y no necesita DICOMWeb:

```json
{ "studies": [ { "StudyInstanceUID": "...",
    "series": [ { "SeriesInstanceUID": "...",
      "instances": [ { "metadata": { /* tags naturalizados */ },
                       "url": "dicomweb:https://relay.../wado?...&contentType=application/dicom" } ] } ] } ] }
```

Es casi la misma forma que ya devuelve `GET /study/{iuid}?client=X` de
dicom-index (`api.py:295`), que además inyecta `wado_url` por instancia
(`_inject_wado_urls`) y `metadata` por serie (`_inject_metadata`).

El streaming ya está resuelto de punta a punta: `relay.py:205-221` lee la
respuesta upstream en chunks y nunca bufferea, y el relay reenvía en
`Transfer-Encoding: chunked`.

**El único bloqueante:** `GET /wado` de dicom-index (`api.py:377`) solo
devuelve `image/jpeg` renderizado (GDCM → numpy → Pillow). Cornerstone3D
necesita el DICOM P10 crudo para hacer window/level, MPR y mediciones en
unidades reales — un JPEG no sirve. Falta soportar
`contentType=application/dicom`, que ya tiene todo lo necesario:
`backend.materialize(info)` entrega la ruta local y se devuelve como
`FileResponse`/`StreamingResponse` en vez de renderizar.
