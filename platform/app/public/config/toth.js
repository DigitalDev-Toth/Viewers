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
// Este archivo entrega una **función** en vez de un objeto. OHIF acepta las
// dos formas (`await appConfigOrFunc(...)` en `platform/app/src/appInit.js`),
// y la función nos deja mirar los monitores del puesto antes de que arranque
// el visor — que es de lo que trata todo el bloque de acá abajo.
//
//   RELAY_REQUEST_TOKEN=... node toth/relay-proxy.mjs
//   APP_CONFIG=config/toth.js pnpm dev
//
//   node --test toth/multimonitor.test.mjs

(function () {
  'use strict';

  // ─── El puesto de diagnóstico ──────────────────────────────────────────
  //
  // El radiólogo trabaja con 2 o 3 pantallas: en una el RIS (listado de
  // pacientes, informe) y en las otras el visor, que no se cierra en toda la
  // jornada. Lo que sigue detecta esas pantallas al arrancar, reparte el
  // visor sobre las de diagnóstico y le da a cada ventana el colgado que le
  // calza por la forma del monitor.
  //
  // Se apoya en la Window Management API, que es de Chromium — el puesto de
  // diagnóstico usa Chrome, así que no hay camino alternativo que mantener:
  //
  //   screen.isExtended    síncrono y sin permiso: ¿hay más de una pantalla?
  //   getScreenDetails()   la lista completa, pero pide permiso una vez.
  //
  // El permiso sólo se puede pedir desde un gesto del usuario, así que el
  // primer arranque en cada puesto muestra un botón. Una vez concedido queda
  // guardado por origen y de ahí en adelante todo pasa solo.
  //
  // Requisito de instalación: el navegador tiene que permitir ventanas
  // emergentes para este origen. Abrir el tercer monitor es un `window.open`
  // sin gesto detrás y el bloqueador se lo come; con la política de empresa
  // `PopupsAllowedForUrls` — o el permiso del sitio, una vez — deja de serlo.
  //
  // Para apagar todo esto en un puesto puntual, desde la consola del visor:
  //   window.tothMonitors.off()

  const MULTIMONITOR = {
    enabled: true,

    // Cuál es el monitor del RIS. En un puesto de radiología el primario es
    // donde vive el escritorio, y los de diagnóstico son los otros. Si en
    // algún puesto no se cumple, esto es lo primero que hay que tocar.
    excludePrimary: true,

    // BioRis reengancha la ventana del visor por su nombre (`windowName:
    // 'OHIF Viewer'` en studies.js). MultiMonitorService renombra cada
    // ventana con el id de su pantalla, así que el id de la primera tiene que
    // ser exactamente ese: si no, el RIS deja de encontrarla y abre una
    // ventana nueva en cada clic.
    firstWindowName: 'OHIF Viewer',

    // Abrir las pantallas de diagnóstico que falten al entrar al modo.
    launchAll: true,

    // Mover la ventana que abrió el RIS al primer monitor de diagnóstico.
    // Sólo se pueden mover ventanas abiertas por script, que es el caso.
    moveFirstWindow: true,

    // Qué colgado abre en cada pantalla de diagnóstico, por posición. Lo que
    // manda no es la forma del monitor —lo probamos y no aporta: dos monitores
    // gemelos reciben lo mismo— sino qué ventana es y qué trae el estudio, que
    // es algo que OHIF resuelve mejor que nosotros.
    //
    //   null  no forzar nada: que el visor elija, que para eso tiene reglas
    //         por modalidad. Hoy eso es 1x1 con la primera serie.
    //
    // La última entrada vale para todas las pantallas que sigan.
    protocols: [null, '@toth/secondScreen'],

    windowOptions: 'fullscreen=yes,location=no,menubar=no,scrollbars=no,status=no,titlebar=no',
  };

  /** Preferencia del puesto, no del usuario: 'auto' | 'off'. */
  const PREF_KEY = 'toth.multimonitor';

  /** Cuánto esperar antes de dar por bloqueada la ventana del otro monitor. */
  const ESPERA_VENTANAS = 5000;

  const readPref = () => {
    try {
      return window.localStorage.getItem(PREF_KEY);
    } catch (error) {
      return null; // modo incógnito o almacenamiento apagado
    }
  };

  const writePref = value => {
    try {
      window.localStorage.setItem(PREF_KEY, value);
    } catch (error) {
      /* si no se puede guardar, se vuelve a preguntar la próxima vez */
    }
  };

  /** El permiso cambió de nombre entre versiones de Chrome. */
  async function permissionState() {
    for (const name of ['window-management', 'window-placement']) {
      try {
        return (await navigator.permissions.query({ name })).state;
      } catch (error) {
        /* esta versión no conoce ese nombre; probamos el otro */
      }
    }
    return 'unsupported';
  }

  /**
   * Las pantallas de diagnóstico, de izquierda a derecha, o null si este
   * puesto no da para repartir el visor. Nunca lanza ni bloquea el arranque.
   */
  async function detectMonitors() {
    if (!MULTIMONITOR.enabled || readPref() === 'off') {
      return null;
    }
    // Barato y sin permiso: si no hay escritorio extendido, no hay nada que
    // repartir y no hace falta molestar a nadie con un permiso.
    if (!window.screen.isExtended || typeof window.getScreenDetails !== 'function') {
      return null;
    }

    const state = await permissionState();
    if (state !== 'granted') {
      if (state === 'prompt') {
        offerSetup(); // deja un botón y sigue; pedirlo acá no tiene gesto
      } else {
        console.info(
          '[toth] sin permiso de gestión de ventanas (%s): el visor abre en una sola pantalla',
          state
        );
      }
      return null;
    }

    const details = await window.getScreenDetails();
    const diagnostic = details.screens
      .filter(screen => !(MULTIMONITOR.excludePrimary && screen.isPrimary))
      .sort((a, b) => a.left - b.left);

    return diagnostic.length ? { details, diagnostic } : null;
  }

  /** El colgado de la pantalla `index`; `null` es «que decida OHIF». */
  const protocolFor = index => {
    const protocols = MULTIMONITOR.protocols;
    return protocols[Math.min(index, protocols.length - 1)] ?? null;
  };

  /** Una entrada de `multimonitor` por cada pantalla de diagnóstico. */
  function screensConfig({ details, diagnostic }) {
    return diagnostic.map((screen, index) => ({
      id:
        index === 0
          ? MULTIMONITOR.firstWindowName
          : MULTIMONITOR.firstWindowName + '-' + (index + 1),
      // El índice tal como lo ve getScreenDetails(): es lo que
      // MultiMonitorService usa después para posicionar la ventana.
      screen: details.screens.indexOf(screen),
      location: { width: 1, height: 1, left: 0, top: 0 },
      options: MULTIMONITOR.windowOptions,
    }));
  }

  /**
   * Deja la URL de esta ventana diciendo en qué pantalla está y con qué
   * colgado abre. Corre antes de que arranque el router, así que el modo lee
   * `hangingProtocolId` y `stageId` como si los hubiera puesto el RIS.
   *
   * Devuelve el número de pantalla de esta ventana.
   */
  function applyUrl(diagnostic, index) {
    const url = new URL(window.location.href);
    const query = url.searchParams;
    const before = url.toString();

    query.set('multimonitor', 'auto');
    if (!query.has('screenNumber')) {
      // Esta es la ventana que abrió el RIS: pasa a ser la pantalla 0 en vez
      // de quedar como una ventana suelta que lanza otras dos.
      query.set('screenNumber', '0');
      if (diagnostic.length > 1 && MULTIMONITOR.launchAll) {
        query.set('launchAll', '1');
      }
    }

    // Las ventanas hijas heredan la query de la madre, colgado incluido. El
    // marcador dice para qué pantalla lo pusimos nosotros: si no es la de esta
    // ventana, lo recalculamos; si no hay marcador y ya venía un colgado, lo
    // puso el RIS y no se toca.
    const marker = query.get('hpAuto');
    const stamp = String(index);
    const chosenByHost =
      marker === null && [...query.keys()].some(key => key.toLowerCase() === 'hangingprotocolid');

    if (!chosenByHost && marker !== stamp) {
      const protocol = protocolFor(index);
      if (protocol) {
        query.set('hangingProtocolId', protocol);
      } else {
        // Sin colgado forzado: es lo que le devuelve la decisión a OHIF. Hay
        // que borrar el heredado, o esta ventana abriría con el de otra.
        query.delete('hangingProtocolId');
      }
      query.delete('stageId');
      query.set('hpAuto', stamp);
    }

    if (url.toString() !== before) {
      window.history.replaceState(null, '', url.toString());
    }
  }

  /** La pantalla que le toca a esta ventana; 0 es la que abrió el RIS. */
  function screenNumberFromUrl() {
    const value = new URL(window.location.href).searchParams.get('screenNumber');
    return value === null ? 0 : Number(value) || 0;
  }

  /**
   * La ventana que abrió el RIS aparece en el monitor del RIS. Moverla al
   * primer monitor de diagnóstico es la mitad del trabajo que el radiólogo
   * hace hoy a mano.
   */
  function placeFirstWindow(screen, index) {
    if (!MULTIMONITOR.moveFirstWindow || index !== 0 || !screen) {
      return;
    }
    // Chrome sólo deja mover ventanas abiertas por script. Si el radiólogo
    // llegó escribiendo la URL, la dejamos donde está.
    if (!window.opener) {
      return;
    }
    const alreadyThere =
      window.screenLeft >= screen.left && window.screenLeft < screen.left + screen.width;
    if (alreadyThere) {
      return;
    }
    try {
      window.moveTo(screen.availLeft, screen.availTop);
      window.resizeTo(screen.availWidth, screen.availHeight);
    } catch (error) {
      console.warn('[toth] no se pudo mover el visor al monitor de diagnóstico:', error);
    }
  }

  let buttonMounted = false;

  /**
   * Un botón discreto abajo a la derecha. Existe porque las dos cosas que
   * faltan —pedir el permiso y abrir la otra ventana— necesitan un clic
   * detrás: el navegador no deja ninguna de las dos sin gesto del usuario.
   */
  function mountButton({ label, title, onClick }) {
    if (buttonMounted) {
      return;
    }
    buttonMounted = true;

    const mount = () => {
      const button = window.document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = title;
      button.style.cssText = [
        'position:fixed',
        'right:16px',
        'bottom:16px',
        'z-index:2147483647',
        'padding:8px 14px',
        'border:1px solid #3a6ea5',
        'border-radius:6px',
        'background:#12263a',
        'color:#e8eef5',
        'font:500 13px/1.2 system-ui,sans-serif',
        'cursor:pointer',
      ].join(';');

      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await onClick();
        } catch (error) {
          button.disabled = false;
          button.textContent = 'No se pudo — reintentar';
          console.warn('[toth]', error);
        }
      });

      window.document.body.appendChild(button);
    };

    if (window.document.body) {
      mount();
    } else {
      window.document.addEventListener('DOMContentLoaded', mount);
    }
  }

  /** El permiso de gestión de ventanas, que sólo se puede pedir desde un clic. */
  function offerSetup() {
    // En una ventana hija el permiso ya está dado; si no lo estuviera, no
    // existiría la ventana.
    if (new URL(window.location.href).searchParams.has('screenNumber')) {
      return;
    }
    mountButton({
      label: 'Usar los monitores de diagnóstico',
      title:
        'Detecta las pantallas del puesto y reparte el visor sobre las de diagnóstico. Se pregunta una sola vez.',
      onClick: async () => {
        await window.getScreenDetails(); // acá sí hay gesto: Chrome pregunta
        writePref('auto');
        window.location.reload();
      },
    });
  }

  /** ¿Quedó alguna pantalla de diagnóstico sin su ventana? */
  function missingWindows(count) {
    const open = (window.multimonitor && window.multimonitor.launchWindows) || [];
    for (let index = 1; index < count; index += 1) {
      if (!open[index] || open[index].closed) {
        return true;
      }
    }
    return false;
  }

  /** Abre las ventanas que falten. Pensado para colgar de un clic. */
  function openMissingWindows() {
    const service = window.services && window.services.multiMonitorService;
    if (!service) {
      throw new Error('el visor todavía no terminó de arrancar');
    }
    return service.launchAll();
  }

  /**
   * `launchAll` corre al entrar al modo, sin gesto del usuario, así que el
   * bloqueador de emergentes se come la ventana del segundo monitor salvo que
   * el puesto tenga permitidas las ventanas emergentes para este origen. Si
   * pasado un momento la ventana no está, ofrecemos abrirla desde un clic,
   * que es lo único que el bloqueador nunca frena.
   */
  function watchForBlockedWindows(count) {
    window.setTimeout(() => {
      if (!missingWindows(count)) {
        return;
      }
      mountButton({
        label: 'Abrir el otro monitor',
        title:
          'El navegador bloqueó la ventana del segundo monitor de diagnóstico. Desde este botón se abre igual.',
        onClick: openMissingWindows,
      });
    }, ESPERA_VENTANAS);
  }

  const describe = screen => ({
    label: screen.label,
    width: screen.width,
    height: screen.height,
    left: screen.left,
    top: screen.top,
    isPrimary: screen.isPrimary,
  });

  /** @returns {AppTypes.Config} */
  function baseConfig() {
    return {
      name: 'config/toth.js',
      routerBasename: null,
      extensions: [
        '@ohif/extension-external-control',
        '@ohif/extension-toth-hps',
        '@ohif/extension-toth-propagate',
      ],
      modes: [],
      customizationService: {
        mode: {
          // El RIS le va empujando al visor los estudios que vienen: el panel
          // muestra arriba el paciente en pantalla y abajo, aparte, la cola.
          '*': { 'studyBrowser.groupByPatient': { $set: true } },
        },
      },
      showStudyList: false,
      // El nombre del paciente en pantalla, siempre a la vista arriba a la
      // derecha: con la cola de los que vienen en el mismo visor, es la forma
      // de no informar sobre el paciente equivocado.
      showPatientInfo: 'visible',

      // El cartel de «for investigational use only» aparece en cada apertura
      // del visor. Acá el visor es una herramienta de trabajo en un puesto de
      // diagnóstico, no una demostración: el radiólogo lo vería veinte veces
      // al día y no le dice nada que no sepa.
      investigationalUseDialog: { option: 'never' },
      maxNumberOfWebWorkers: 3,
      defaultDataSourceName: 'dicomjson',

      // El puesto de diagnóstico: el radiólogo deja el visor abierto en su
      // segunda pantalla toda la jornada y BioRis le va empujando estudios
      // por postMessage, sin recargarlo — recargar cuesta las mediciones, el
      // layout y la caché de imágenes.
      //
      // Cualquier página de estos orígenes que consiga un handle a la ventana
      // del visor puede manejarlo, así que la lista es lo más angosta que
      // permite el despliegue.
      externalControl: {
        allowedOrigins: [
          // Cada centro tiene su BioRis en `<centro>.cui.date`, y los de QA en
          // `<centro>.qa.cui.date`. El patrón acepta exactamente un nivel de
          // subdominio, con este esquema y sin puerto (ver
          // ExternalControlChannel). Cubre también el propio visor
          // (ohif.cui.date), que es lo que deja a su página de demostración
          // (/external-control/example.html) manejarlo.
          //
          // El costo: un subdominio de cui.date que algún día sirviera
          // contenido ajeno podría manejar el visor. Si eso pasa, este patrón
          // es lo primero que hay que reemplazar por la lista de centros.
          'https://*.cui.date',
          'https://*.qa.cui.date',
          // Desarrollo: BioRis servido en local contra este visor.
          'http://localhost:8080',
          'http://localhost:3000',
          // BioRis local de un centro, que entra por `<centro>.localhost`
          // para que la cookie de sesión no se mezcle entre centros.
          'http://norteimagen.localhost:8083',
        ],
        // `RUN_COMMANDS` deja al host correr cualquier comando del visor.
        // Agregar y quitar estudios no necesita eso, así que queda apagado
        // hasta que haya una razón concreta.
        allowRunCommands: false,
        // En desarrollo los manifiestos vienen de toth/relay-proxy.mjs, en
        // otro puerto; la extensión sólo acepta los del mismo origen salvo
        // que se nombren. En producción salen de /api del propio visor, así
        // que ahí la lista queda vacía.
        allowedManifestOrigins:
          window.location.hostname === 'localhost' ? ['http://localhost:3001'] : [],
      },

      // Precarga reactiva al viewport activo. El servicio ya venía en OHIF y
      // estaba apagado; en una sesión que dura horas es justo lo que evita
      // que cada scroll pida imágenes que ya podrían estar en memoria.
      studyPrefetcher: {
        enabled: true,
        displaySetsCount: 2,
        // Peticiones en vuelo a la vez, no en total: cada una atraviesa el
        // relay hasta el conector del centro, así que subirlo lo congestiona.
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
            // `dicomjson` toma el manifiesto de un `?url=` arbitrario, así
            // que upstream pide acotarlo: sin esto, una URL de visor
            // manipulada podría hacer que cargue metadata de cualquier host.
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
  }

  window.config = async function () {
    let detected = null;

    try {
      detected = await detectMonitors();
      if (detected) {
        const index = screenNumberFromUrl();
        // Mudarla primero y mirar después dónde quedó: el colgado depende del
        // monitor real, y la mudanza no siempre se puede.
        placeFirstWindow(detected.diagnostic[index], index);
        applyUrl(detected.diagnostic, index);
        if (index === 0 && detected.diagnostic.length > 1) {
          watchForBlockedWindows(detected.diagnostic.length);
        }
      }
    } catch (error) {
      // Un puesto sin monitores repartidos sigue siendo un visor que anda.
      console.warn('[toth] autodetección de monitores desactivada:', error);
      detected = null;
    }

    // Handle para depurar en el puesto, desde la consola del visor.
    window.tothMonitors = {
      screens: detected ? detected.diagnostic.map(describe) : null,
      protocolFor,
      openWindows: openMissingWindows,
      on: () => {
        writePref('auto');
        window.location.reload();
      },
      off: () => {
        writePref('off');
        window.location.reload();
      },
    };

    return Object.assign(baseConfig(), {
      multimonitor: [
        detected
          ? {
              id: 'auto',
              test: params => params.multimonitor === 'auto',
              screens: screensConfig(detected),
            }
          : // Una sola pantalla: una entrada que no calza nunca, para que el
            // servicio quede en «una pantalla» en vez de indefinido.
            { id: 'auto', test: () => false, screens: [] },
      ],
    });
  };
})();
