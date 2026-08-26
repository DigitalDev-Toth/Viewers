/**
 * La autodetección de monitores del puesto de diagnóstico.
 *
 *   node --test toth/multimonitor.test.mjs
 *
 * `config/toth.js` decide, antes de que arranque el visor, en qué pantalla va
 * cada ventana y con qué colgado abre. Eso sólo se puede probar a mano en un
 * puesto con tres monitores, así que acá se carga el archivo en un contexto
 * con pantallas de mentira y se mira lo único que el visor va a leer después:
 * la URL que queda y el arreglo `multimonitor` que devuelve.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = fs.readFileSync(
  path.join(AQUI, '..', 'platform', 'app', 'public', 'config', 'toth.js'),
  'utf8'
);

// ── pantallas de mentira ───────────────────────────────────────────────────

/** Un monitor tal como lo describe getScreenDetails(). */
const pantalla = ({ label, width, height, left, isPrimary = false }) => ({
  label,
  width,
  height,
  availWidth: width,
  availHeight: height,
  left,
  top: 0,
  availLeft: left,
  availTop: 0,
  isPrimary,
});

const RIS = pantalla({ label: 'Dell U2412', width: 1920, height: 1200, left: 0, isPrimary: true });
const VERTICAL = pantalla({ label: 'Barco MDRC-2222', width: 1536, height: 2048, left: 1920 });
const VERTICAL_2 = pantalla({ label: 'Barco MDRC-2222', width: 1536, height: 2048, left: 3456 });
const ULTRAANCHO = pantalla({ label: 'LG 34WN', width: 3440, height: 1440, left: 3456 });

/**
 * Un `window` con lo justo que toca el archivo de configuración. Devuelve
 * también el registro de lo que se le hizo, que es lo que se afirma después.
 */
function contexto({
  href = 'https://ohif.cui.date/viewer?url=%2Fapi%2Fstudy%2F1.2.3',
  screens = [RIS],
  permission = 'granted',
  pref = null,
  opener = true,
  screenLeft = 0,
} = {}) {
  const registro = { movida: null, redimensionada: null, recargas: 0, botones: [] };
  const almacenamiento = new Map(pref === null ? [] : [['toth.multimonitor', pref]]);

  const elemento = () => ({
    style: { cssText: '' },
    handlers: {},
    addEventListener(evento, handler) {
      this.handlers[evento] = handler;
    },
  });

  const window = {
    opener: opener ? {} : null,
    screenLeft,
    screenTop: 0,
    screen: { isExtended: screens.length > 1 },
    localStorage: {
      getItem: clave => (almacenamiento.has(clave) ? almacenamiento.get(clave) : null),
      setItem: (clave, valor) => almacenamiento.set(clave, valor),
    },
    location: {
      href,
      reload: () => {
        registro.recargas += 1;
      },
    },
    history: {
      replaceState: (_estado, _titulo, url) => {
        window.location.href = url;
      },
    },
    document: {
      body: {
        appendChild: nodo => registro.botones.push(nodo),
      },
      createElement: elemento,
      addEventListener: () => {},
    },
    getScreenDetails: async () => ({ screens, currentScreen: screens[0] }),
    moveTo: (left, top) => {
      registro.movida = { left, top };
      window.screenLeft = left; // el navegador la mueve de verdad
      window.screenTop = top;
    },
    resizeTo: (width, height) => {
      registro.redimensionada = { width, height };
    },
  };

  const sandbox = {
    window,
    console: { warn: () => {}, info: () => {}, log: () => {} },
    navigator: {
      permissions: {
        query: async ({ name }) => {
          if (name !== 'window-management') {
            throw new TypeError('permiso desconocido');
          }
          return { state: permission };
        },
      },
    },
    URL,
    URLSearchParams,
  };

  vm.createContext(sandbox);
  vm.runInContext(CONFIG, sandbox);
  return { window, registro, almacenamiento };
}

/** Corre la configuración y devuelve lo que el visor va a ver. */
async function arrancar(opciones) {
  const { window, registro, almacenamiento } = contexto(opciones);
  const config = await window.config({});
  const url = new URL(window.location.href);
  return { config, url, query: url.searchParams, window, registro, almacenamiento };
}

const entrada = config => config.multimonitor[0];

// ── un solo monitor ────────────────────────────────────────────────────────

test('con una sola pantalla no toca nada y deja el visor en modo simple', async () => {
  const { config, url, window } = await arrancar({ screens: [RIS] });

  assert.equal(url.searchParams.has('multimonitor'), false);
  assert.equal(url.searchParams.has('screenNumber'), false);
  assert.equal(entrada(config).test({ multimonitor: 'auto' }), false);
  assert.equal(window.tothMonitors.screens, null);
});

test('un puesto que dijo que no vuelve a arrancar en modo simple, sin pedir permiso', async () => {
  const { config, url } = await arrancar({
    screens: [RIS, VERTICAL],
    pref: 'off',
    permission: 'prompt',
  });

  assert.equal(url.searchParams.has('multimonitor'), false);
  assert.equal(entrada(config).test({ multimonitor: 'auto' }), false);
});

// ── dos monitores: RIS + uno de diagnóstico ────────────────────────────────

test('dos pantallas: el visor se queda con la que no es la del RIS', async () => {
  const { config, query, window } = await arrancar({ screens: [RIS, VERTICAL] });

  assert.deepEqual(
    entrada(config).screens.map(s => ({ id: s.id, screen: s.screen })),
    [{ id: 'ohif-diagnostico', screen: 1 }]
  );
  assert.equal(query.get('multimonitor'), 'auto');
  assert.equal(query.get('screenNumber'), '0');
  // Una sola pantalla de diagnóstico: no hay ninguna ventana que abrir.
  assert.equal(query.has('launchAll'), false);
  assert.equal(window.tothMonitors.screens.length, 1);
});

test('el nombre de la primera ventana es el que BioRis usa para reengancharla', async () => {
  const { config } = await arrancar({ screens: [RIS, VERTICAL, VERTICAL_2] });

  assert.equal(entrada(config).screens[0].id, 'ohif-diagnostico');
  assert.equal(entrada(config).screens[1].id, 'ohif-diagnostico-2');
});

test('un monitor vertical abre con una imagen grande', async () => {
  const { query } = await arrancar({ screens: [RIS, VERTICAL] });

  assert.equal(query.get('hangingProtocolId'), '@ohif/mnGrid');
  assert.equal(query.get('stageId'), '1x1');
  assert.equal(query.get('hpAuto'), String(VERTICAL.left));
});

test('un monitor ultraancho abre con la grilla de ocho', async () => {
  const { query } = await arrancar({ screens: [RIS, ULTRAANCHO] });

  assert.equal(query.get('hangingProtocolId'), '@ohif/mnGrid8');
  assert.equal(query.get('stageId'), '4x2');
});

test('la ventana que abrió el RIS se muda al monitor de diagnóstico', async () => {
  const { registro } = await arrancar({ screens: [RIS, VERTICAL], screenLeft: 100 });

  assert.deepEqual(registro.movida, { left: 1920, top: 0 });
  assert.deepEqual(registro.redimensionada, { width: 1536, height: 2048 });
});

test('una ventana que ya está en su monitor no se mueve', async () => {
  const { registro } = await arrancar({ screens: [RIS, VERTICAL], screenLeft: 2000 });

  assert.equal(registro.movida, null);
});

test('una ventana que el radiólogo abrió a mano no se mueve sola', async () => {
  const { registro } = await arrancar({ screens: [RIS, VERTICAL], opener: false });

  assert.equal(registro.movida, null);
});

test('si la ventana no se pudo mudar, el colgado sale del monitor donde quedó', async () => {
  // Una pestaña —lo que abre hoy traza-almacenamiento— no se puede mover: se
  // queda en el monitor del RIS, que es horizontal.
  const { query } = await arrancar({ screens: [RIS, VERTICAL], opener: false });

  assert.equal(query.get('hangingProtocolId'), '@ohif/mnGrid');
  assert.equal(query.get('stageId'), '2x2');
  assert.equal(query.get('hpAuto'), String(RIS.left));
});

test('una ventana arrastrada a otra pantalla recalcula su colgado al recargar', async () => {
  const { query } = await arrancar({
    screens: [RIS, VERTICAL],
    opener: false,
    // Ya pasó por acá una vez, en el monitor del RIS, y el radiólogo la movió.
    screenLeft: VERTICAL.left,
    href: 'https://ohif.cui.date/viewer?multimonitor=auto&screenNumber=0&hpAuto=0',
  });

  assert.equal(query.get('stageId'), '1x1');
  assert.equal(query.get('hpAuto'), String(VERTICAL.left));
});

// ── tres monitores ─────────────────────────────────────────────────────────

test('tres pantallas: pide abrir la segunda ventana de diagnóstico', async () => {
  const { config, query } = await arrancar({ screens: [RIS, VERTICAL, VERTICAL_2] });

  assert.equal(entrada(config).screens.length, 2);
  assert.equal(query.get('launchAll'), '1');
  assert.equal(entrada(config).test({ multimonitor: 'auto' }), true);
  assert.equal(entrada(config).test({ multimonitor: 'split' }), false);
});

test('las pantallas de diagnóstico quedan ordenadas de izquierda a derecha', async () => {
  const { config } = await arrancar({ screens: [VERTICAL_2, RIS, VERTICAL] });

  // Índices tal como los ve getScreenDetails(), no el orden de la lista.
  assert.deepEqual(
    entrada(config).screens.map(s => s.screen),
    [2, 0]
  );
});

// ── la ventana hija ────────────────────────────────────────────────────────

test('la ventana hija recalcula el colgado para su propio monitor', async () => {
  const { query } = await arrancar({
    screens: [RIS, VERTICAL, ULTRAANCHO],
    // MultiMonitorService la abre ya puesta en su pantalla...
    screenLeft: ULTRAANCHO.left,
    // ...y heredando la query de la madre, colgado incluido.
    href:
      'https://ohif.cui.date/viewer?url=%2Fapi%2Fstudy%2F1.2.3&multimonitor=auto' +
      '&hangingProtocolId=%40ohif%2FmnGrid&stageId=1x1&hpAuto=1920&screenNumber=1',
  });

  assert.equal(query.get('screenNumber'), '1');
  assert.equal(query.get('hangingProtocolId'), '@ohif/mnGrid8');
  assert.equal(query.get('stageId'), '4x2');
  assert.equal(query.get('hpAuto'), String(ULTRAANCHO.left));
});

test('la ventana hija no se vuelve a mover ni relanza a las demás', async () => {
  const { query, registro } = await arrancar({
    screens: [RIS, VERTICAL, VERTICAL_2],
    screenLeft: VERTICAL_2.left,
    href: 'https://ohif.cui.date/viewer?multimonitor=auto&screenNumber=1',
  });

  assert.equal(query.has('launchAll'), false);
  assert.equal(registro.movida, null);
});

test('un colgado pedido por el RIS manda sobre el de la pantalla', async () => {
  const { query } = await arrancar({
    screens: [RIS, VERTICAL],
    href: 'https://ohif.cui.date/viewer?url=%2Fapi&hangingProtocolId=%40ohif%2FhpCompare',
  });

  assert.equal(query.get('hangingProtocolId'), '@ohif/hpCompare');
  assert.equal(query.has('hpAuto'), false);
});

// ── el permiso ─────────────────────────────────────────────────────────────

test('sin permiso todavía, arranca en simple y deja el botón para pedirlo', async () => {
  const { config, url, registro, window, almacenamiento } = await arrancar({
    screens: [RIS, VERTICAL],
    permission: 'prompt',
  });

  assert.equal(entrada(config).test({ multimonitor: 'auto' }), false);
  assert.equal(url.searchParams.has('multimonitor'), false);
  assert.equal(registro.botones.length, 1);

  // El clic sí tiene gesto detrás: pide el permiso, lo recuerda y recarga.
  await registro.botones[0].handlers.click();
  assert.equal(almacenamiento.get('toth.multimonitor'), 'auto');
  assert.equal(registro.recargas, 1);
  assert.equal(window.tothMonitors.screens, null);
});

test('con el permiso denegado no insiste con el botón', async () => {
  const { registro } = await arrancar({ screens: [RIS, VERTICAL], permission: 'denied' });

  assert.equal(registro.botones.length, 0);
});

// ── el resto de la configuración sigue en pie ──────────────────────────────

test('la configuración del visor no cambia por todo esto', async () => {
  const { config } = await arrancar({ screens: [RIS, VERTICAL] });

  assert.equal(config.defaultDataSourceName, 'dicomjson');
  assert.deepEqual([...config.extensions], ['@ohif/extension-external-control']);
  assert.equal(config.externalControl.allowedOrigins.includes('https://php8.cui.date'), true);
  assert.equal(config.externalControl.allowRunCommands, false);
  assert.equal(config.studyPrefetcher.enabled, true);
});
