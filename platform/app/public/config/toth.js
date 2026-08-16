/** @type {AppTypes.Config} */

// Toth / Cuidate — visor contra dicom-index a través de dicom-relay.
//
// El estudio entra por el data source `dicomjson`: dicom-index expone
// `GET /study/{iuid}/ohif`, que devuelve el manifiesto en la forma que ese
// data source ya sabe leer. Por eso acá no hay código propio del visor —
// sólo configuración, que es lo que sobrevive a un `git fetch upstream`.
//
// Las imágenes se piden como DICOM crudo (`contentType=application/dicom`) y
// Cornerstone las parsea en el navegador: window/level, MPR y mediciones en
// mm salen de los píxeles de 16 bits reales, no de un JPEG ya renderizado.
//
// Nada apunta al relay directamente. Todo pasa por `toth/relay-proxy.mjs` en
// localhost:3001, que agrega el RELAY_REQUEST_TOKEN del lado del servidor —
// ese token es una credencial de infraestructura compartida y no debe llegar
// nunca al navegador.
//
//   RELAY_REQUEST_TOKEN=... node toth/relay-proxy.mjs
//   APP_CONFIG=config/toth.js pnpm dev
window.config = {
  name: 'config/toth.js',
  routerBasename: null,
  extensions: [],
  modes: [],
  customizationService: {},
  showStudyList: false,
  maxNumberOfWebWorkers: 3,
  defaultDataSourceName: 'dicomjson',

  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomjson',
      sourceName: 'dicomjson',
      configuration: {
        friendlyName: 'dicom-index (via relay)',
        name: 'json',
        // `dicomjson` toma el manifiesto de un `?url=` arbitrario, así que
        // upstream pide acotarlo: sin esto, una URL de visor manipulada
        // podría hacer que cargue metadata de cualquier host.
        //
        // Sólo hace falta para desarrollo, donde el proxy vive en otro
        // puerto. En Cloud Run el manifiesto sale de `/api/...` del mismo
        // contenedor, y `resolveConfigFetchPolicy` deja pasar el mismo
        // origen sin consultar esta lista.
        dangerouslyAllowedOriginsForAuthenticatedEnvironments: [
          'http://localhost:3001',
        ],
      },
    },
  ],

  httpErrorHandler: error => {
    console.warn('[toth] error del data source:', error.status, error);
  },
};
