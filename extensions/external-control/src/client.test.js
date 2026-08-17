/**
 * The host-side client. It lives under `public/` because third parties load it
 * with a <script> tag and have no build step; its tests live here like every
 * other one.
 *
 * What is worth testing is the part that is easy to get wrong and invisible
 * when it breaks: a call made a beat too early must not vanish, and two
 * answers in flight must not swap places.
 */

const OHIFExternalControl = require('../public/external-control/client.js');

const VIEWER = 'https://viewer.example.org';

function fakeViewerWindow() {
  return { postMessage: jest.fn(), closed: false, focus: jest.fn(), close: jest.fn() };
}

/** A message the way the browser would deliver it from the viewer window. */
function fromViewer(data, { source, origin = VIEWER } = {}) {
  window.dispatchEvent(
    Object.assign(new Event('message'), { origin, source: source ?? null, data })
  );
}

function ready(source, capabilities = ['ADD_STUDIES', 'REMOVE_STUDIES', 'FOCUS']) {
  fromViewer(
    {
      channel: 'ohif-external-control',
      version: 1,
      type: 'READY',
      capabilities,
    },
    { source }
  );
}

function result(requestId, extra) {
  fromViewer({
    channel: 'ohif-external-control',
    version: 1,
    type: 'RESULT',
    requestId,
    ...extra,
  });
}

/** The requestId the client generated for its Nth outgoing message. */
function sentRequestId(viewerWindow, index = 0) {
  return viewerWindow.postMessage.mock.calls[index][0].requestId;
}

describe('OHIFExternalControl client', () => {
  let viewerWindow;
  let client;

  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    viewerWindow = fakeViewerWindow();
    client = OHIFExternalControl.connect({ viewerOrigin: VIEWER, openUrl: VIEWER + '/' });
  });

  afterEach(() => {
    client.destroy();
    jest.useRealTimers();
  });

  it('exige un viewerOrigin: sin él no hay a quién dirigir los mensajes', () => {
    expect(() => OHIFExternalControl.connect({})).toThrow(/viewerOrigin/);
  });

  describe('cola previa al READY', () => {
    it('no pierde una llamada hecha antes de que el visor conteste', () => {
      client.viewerWindow = viewerWindow;
      const promesa = client.addStudies(['1.2.3']);

      // postMessage no tiene buffer: enviarlo ahora sería tirarlo a la basura.
      expect(viewerWindow.postMessage).not.toHaveBeenCalled();

      ready(viewerWindow);

      expect(viewerWindow.postMessage).toHaveBeenCalledTimes(1);
      expect(viewerWindow.postMessage.mock.calls[0][0]).toMatchObject({
        action: 'ADD_STUDIES',
        payload: { studies: ['1.2.3'] },
      });
      expect(promesa).toBeInstanceOf(Promise);
    });

    it('vacía la cola en orden', () => {
      client.viewerWindow = viewerWindow;
      client.addStudies(['1']);
      client.addStudies(['2']);
      client.focus({ StudyInstanceUID: '1' });

      ready(viewerWindow);

      expect(viewerWindow.postMessage.mock.calls.map(call => call[0].action)).toEqual([
        'ADD_STUDIES',
        'ADD_STUDIES',
        'FOCUS',
      ]);
    });

    it('una vez conectado envía de inmediato, sin pasar por la cola', () => {
      client.viewerWindow = viewerWindow;
      ready(viewerWindow);

      client.removeStudies(['9']);

      expect(viewerWindow.postMessage).toHaveBeenCalledTimes(1);
    });

    it('siempre dirige el mensaje al origen del visor', () => {
      client.viewerWindow = viewerWindow;
      ready(viewerWindow);
      client.addStudies(['1']);

      expect(viewerWindow.postMessage.mock.calls[0][1]).toBe(VIEWER);
    });
  });

  describe('correlación', () => {
    beforeEach(() => {
      client.viewerWindow = viewerWindow;
      ready(viewerWindow);
    });

    it('resuelve cada promesa con su propia respuesta', async () => {
      const primera = client.addStudies(['1']);
      const segunda = client.addStudies(['2']);
      const [idPrimera, idSegunda] = [
        sentRequestId(viewerWindow, 0),
        sentRequestId(viewerWindow, 1),
      ];

      // Contestadas al revés, a propósito.
      result(idSegunda, { ok: true, result: { added: ['2'] } });
      result(idPrimera, { ok: true, result: { added: ['1'] } });

      await expect(primera).resolves.toEqual({ added: ['1'] });
      await expect(segunda).resolves.toEqual({ added: ['2'] });
    });

    it('rechaza con el código que mandó el visor', async () => {
      const promesa = client.focus({ StudyInstanceUID: 'no-existe' });
      result(sentRequestId(viewerWindow), {
        ok: false,
        error: { code: 'NOT_FOUND', message: 'no existe' },
      });

      await expect(promesa).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'no existe' });
    });

    it('ignora una respuesta que viene de otro origen', async () => {
      const promesa = client.addStudies(['1']);
      const requestId = sentRequestId(viewerWindow);
      let settled = false;
      promesa.then(
        () => (settled = true),
        () => (settled = true)
      );

      fromViewer(
        {
          channel: 'ohif-external-control',
          version: 1,
          type: 'RESULT',
          requestId,
          ok: true,
          result: 'inyectado',
        },
        { origin: 'https://attacker.example' }
      );
      await Promise.resolve();

      expect(settled).toBe(false);
      promesa.catch(() => {});
    });

    it('ignora una respuesta a un requestId que no pidió', async () => {
      expect(() => result('inventado', { ok: true, result: 1 })).not.toThrow();
    });

    it('caduca la petición que nadie contesta', async () => {
      const promesa = client.addStudies(['1']);
      const esperada = expect(promesa).rejects.toMatchObject({ code: 'TIMEOUT' });

      jest.advanceTimersByTime(60000);

      await esperada;
    });
  });

  describe('reencontrar la ventana', () => {
    it('sin rastro de una sesión previa abre directo por URL', () => {
      window.open = jest.fn(() => viewerWindow);

      client.open();

      expect(window.open).toHaveBeenCalledWith(VIEWER + '/', 'ohif-viewer', '');
    });

    it('si hay rastro reengancha por nombre, sin navegar', () => {
      window.localStorage.setItem('ohif-external-control:ohif-viewer', String(Date.now()));
      window.open = jest.fn(() => viewerWindow);

      client.open();

      // Navegar acá mataría la sesión que el radiólogo tiene abierta.
      expect(window.open).toHaveBeenCalledWith('', 'ohif-viewer', '');
    });

    it('si nadie contesta el handshake, recién ahí navega la ventana', () => {
      window.localStorage.setItem('ohif-external-control:ohif-viewer', String(Date.now()));
      viewerWindow.location = { href: '' };
      window.open = jest.fn(() => viewerWindow);

      const promesa = client.open();
      promesa.catch(() => {});
      expect(viewerWindow.location.href).toBe('');

      // `window.open('', nombre)` inventa una ventana en blanco cuando no
      // existe ninguna, así que el silencio es la única señal de que lo que
      // tenemos delante no es un visor.
      jest.advanceTimersByTime(2500);

      expect(viewerWindow.location.href).toBe(VIEWER + '/');
    });

    it('reintenta el handshake mientras espera', () => {
      window.open = jest.fn(() => viewerWindow);
      client.open().catch(() => {});

      jest.advanceTimersByTime(1000);

      const handshakes = viewerWindow.postMessage.mock.calls.filter(
        call => call[0].action === 'HANDSHAKE'
      );
      expect(handshakes.length).toBeGreaterThan(1);
    });

    it('rechaza cuando el navegador bloquea la ventana emergente', async () => {
      window.open = jest.fn(() => null);

      await expect(client.open()).rejects.toMatchObject({ code: 'POPUP_BLOCKED' });
    });

    it('se queda con la ventana que realmente contestó', () => {
      const otra = fakeViewerWindow();
      client.viewerWindow = viewerWindow;

      ready(otra);

      expect(client.viewerWindow).toBe(otra);
    });

    it('no reabre una ventana viva: sería tirar la sesión', () => {
      client.viewerWindow = viewerWindow;
      viewerWindow.location = { href: 'ya-estaba' };
      ready(viewerWindow);
      window.open = jest.fn();

      client.open();

      expect(window.open).not.toHaveBeenCalled();
      expect(viewerWindow.location.href).toBe('ya-estaba');
    });

    it('con force sí la recarga, para cambiarle las credenciales', () => {
      // El caso real: la ventana venía de un enlace de un solo estudio y hay
      // que dejarla con la cookie de sesión.
      client.viewerWindow = viewerWindow;
      viewerWindow.location = { href: 'ya-estaba' };
      ready(viewerWindow);

      client.open(VIEWER + '/open?token=sesion', { force: true }).catch(() => {});

      expect(viewerWindow.location.href).toBe(VIEWER + '/open?token=sesion');
      expect(client.connected).toBe(false);
    });

    it('tras un force no vuelve a navegar al primer plazo', () => {
      client.viewerWindow = viewerWindow;
      viewerWindow.location = { href: '' };
      ready(viewerWindow);
      client.open(VIEWER + '/uno', { force: true }).catch(() => {});
      viewerWindow.location.href = 'cargando';

      jest.advanceTimersByTime(2500);

      // Renavegar acá reiniciaría una carga que ya está en curso.
      expect(viewerWindow.location.href).toBe('cargando');
    });

    it('emite `ready` una sola vez aunque el visor lo repita', () => {
      const escucha = jest.fn();
      client.on('ready', escucha);

      ready(viewerWindow);
      ready(viewerWindow);

      expect(escucha).toHaveBeenCalledTimes(1);
    });
  });
});
