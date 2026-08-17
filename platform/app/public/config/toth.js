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
  extensions: ['@ohif/extension-external-control'],
  modes: [],
  customizationService: {},
  showStudyList: false,
  maxNumberOfWebWorkers: 3,
  defaultDataSourceName: 'dicomjson',

  // El puesto de diagnóstico: el radiólogo deja el visor abierto en su segunda
  // pantalla toda la jornada y BioRis le va empujando estudios por
  // postMessage, sin recargarlo — recargar cuesta las mediciones, el layout y
  // la caché de imágenes.
  //
  // La lista es exacta y sin comodines: cualquier página de estos orígenes que
  // consiga un handle a la ventana del visor puede manejarlo.
  externalControl: {
    allowedOrigins: [
      'https://php8.cui.date',
      // Desarrollo: BioRis servido en local contra este visor.
      'http://localhost:8080',
      'http://localhost:3000',
    ],
    // `RUN_COMMANDS` deja al host correr cualquier comando del visor. Agregar
    // y quitar estudios no necesita eso, así que queda apagado hasta que haya
    // una razón concreta.
    allowRunCommands: false,
  },

  // Precarga reactiva al viewport activo. El servicio ya venía en OHIF y
  // estaba apagado; en una sesión que dura horas es justo lo que evita que
  // cada scroll pida imágenes que ya podrían estar en memoria.
  studyPrefetcher: {
    enabled: true,
    displaySetsCount: 2,
    // Peticiones en vuelo a la vez, no en total: cada una atraviesa el relay
    // hasta el conector del centro, así que subirlo mucho lo congestiona.
    maxNumPrefetchRequests: 10,
    order: 'closest',
  },

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
        dangerouslyAllowedOriginsForAuthenticatedEnvironments: ['http://localhost:3001'],
      },
    },
  ],

  httpErrorHandler: error => {
    console.warn('[toth] error del data source:', error.status, error);
  },
};
