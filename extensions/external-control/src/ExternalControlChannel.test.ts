/**
 * The channel is the security boundary: everything it lets through can drive
 * the viewer. These tests are weighted accordingly — most of them are about
 * what it must refuse, not what it must do.
 */

import ExternalControlChannel from './ExternalControlChannel';
import { Actions, CHANNEL, ErrorCodes, ExternalControlError, PROTOCOL_VERSION } from './protocol';

const ALLOWED = 'https://ris.example.org';

/** A window stand-in that records what was posted and to which origin. */
function fakePeer() {
  return { postMessage: jest.fn() } as unknown as Window & { postMessage: jest.Mock };
}

/**
 * jsdom's own postMessage ignores the target origin and cannot forge
 * `event.source`, so the listener is driven directly with the event shape the
 * browser would deliver.
 */
function deliver(win: Window, event: Partial<MessageEvent>) {
  win.dispatchEvent(
    Object.assign(new Event('message'), {
      origin: ALLOWED,
      source: fakePeer(),
      data: {},
      ...event,
    })
  );
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    channel: CHANNEL,
    version: PROTOCOL_VERSION,
    requestId: 'r1',
    action: Actions.ADD_STUDIES,
    payload: {},
    ...overrides,
  };
}

const silent = { warn: jest.fn(), error: jest.fn() };

/** Lets the handler's promise and the reply settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('ExternalControlChannel', () => {
  let handler: jest.Mock;
  let channel: ExternalControlChannel;

  beforeEach(() => {
    handler = jest.fn().mockResolvedValue({ added: ['1.2.3'] });
    channel = new ExternalControlChannel({
      allowedOrigins: [ALLOWED],
      handlers: { [Actions.ADD_STUDIES]: handler },
      targetWindow: window,
      logger: silent,
    });
    channel.start();
  });

  afterEach(() => {
    channel.stop();
    jest.clearAllMocks();
  });

  describe('quién puede hablar', () => {
    it('ignora un mensaje de un origen que no está en la lista', async () => {
      deliver(window, { origin: 'https://attacker.example', data: request() });
      await settle();

      expect(handler).not.toHaveBeenCalled();
    });

    it('no acepta `*` como origen permitido: quedaría abierto a cualquiera', () => {
      const wildcard = new ExternalControlChannel({
        allowedOrigins: ['*'],
        handlers: {},
        targetWindow: window,
        logger: silent,
      });

      expect(wildcard.isEnabled).toBe(false);
    });

    describe('patrón de subdominio', () => {
      const conPatron = (allowedOrigins: string[]) =>
        new ExternalControlChannel({
          allowedOrigins,
          handlers: {},
          targetWindow: window,
          logger: silent,
        });

      it('acepta un subdominio de un nivel', () => {
        const patron = conPatron(['https://*.cui.date']);

        expect(patron.isEnabled).toBe(true);
        expect(patron.isAllowedOrigin('https://norteimagen.cui.date')).toBe(true);
      });

      it.each([
        ['el dominio pelado', 'https://cui.date'],
        ['dos niveles de subdominio', 'https://a.b.cui.date'],
        ['otro esquema', 'http://norteimagen.cui.date'],
        ['otro puerto', 'https://norteimagen.cui.date:8443'],
        ['un dominio que sólo termina igual', 'https://evilcui.date'],
        ['un dominio que lo usa de prefijo', 'https://norteimagen.cui.date.attacker.example'],
      ])('rechaza %s', (_, origin) => {
        expect(conPatron(['https://*.cui.date']).isAllowedOrigin(origin)).toBe(false);
      });

      it.each([
        ['un TLD entero', 'https://*.date'],
        ['un comodín en medio', 'https://norte*.cui.date'],
        ['un comodín sin esquema', '*.cui.date'],
        ['un comodín con ruta', 'https://*.cui.date/'],
      ])('no acepta como patrón %s', (_, pattern) => {
        expect(conPatron([pattern]).isEnabled).toBe(false);
      });

      it('respeta el puerto del patrón', () => {
        const patron = conPatron(['http://*.cui.test:8083']);

        expect(patron.isAllowedOrigin('http://norteimagen.cui.test:8083')).toBe(true);
        expect(patron.isAllowedOrigin('http://norteimagen.cui.test:8084')).toBe(false);
      });
    });

    it('sin orígenes configurados no instala el listener', async () => {
      channel.stop(); // el canal del beforeEach comparte esta misma ventana
      const inert = new ExternalControlChannel({
        handlers: { [Actions.ADD_STUDIES]: handler },
        targetWindow: window,
        logger: silent,
      });
      inert.start();

      deliver(window, { data: request() });
      await settle();

      expect(handler).not.toHaveBeenCalled();
    });

    it('descarta un mensaje sin `source`: no hay a quién responderle', async () => {
      deliver(window, { source: null, data: request() });
      await settle();

      expect(handler).not.toHaveBeenCalled();
    });

    it('ignora tráfico de otro canal en la misma ventana', async () => {
      deliver(window, { data: { ...request(), channel: 'otra-cosa' } });
      await settle();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('mensajes malformados', () => {
    // Cada uno de estos llegó a tumbar un listener escrito a la ligera. El
    // canal tiene que seguir vivo después de todos.
    it.each([
      ['null', null],
      ['un string', 'hola'],
      ['sin action', { channel: CHANNEL, version: PROTOCOL_VERSION }],
      ['con action no-string', { channel: CHANNEL, version: PROTOCOL_VERSION, action: 42 }],
    ])('sobrevive a %s', async (_name, data) => {
      deliver(window, { data });
      await settle();

      const peer = fakePeer();
      deliver(window, { source: peer, data: request() });
      await settle();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('un payload que no es objeto llega al handler como objeto vacío', async () => {
      deliver(window, { data: request({ payload: 'no soy un objeto' }) });
      await settle();

      expect(handler).toHaveBeenCalledWith({});
    });
  });

  describe('respuestas', () => {
    it('responde al origen que preguntó, no a `*`', async () => {
      const peer = fakePeer();
      deliver(window, { source: peer, data: request() });
      await settle();

      expect(peer.postMessage).toHaveBeenCalledWith(expect.any(Object), ALLOWED);
    });

    it('correlaciona la respuesta con el requestId de la petición', async () => {
      const peer = fakePeer();
      deliver(window, { source: peer, data: request({ requestId: 'abc-42' }) });
      await settle();

      expect(peer.postMessage.mock.calls[0][0]).toMatchObject({
        type: 'RESULT',
        requestId: 'abc-42',
        ok: true,
        result: { added: ['1.2.3'] },
      });
    });

    it('no confunde dos peticiones simultáneas', async () => {
      const peer = fakePeer();
      let resolvePrimera;
      handler
        .mockImplementationOnce(() => new Promise(resolve => (resolvePrimera = resolve)))
        .mockResolvedValueOnce('segunda');

      deliver(window, { source: peer, data: request({ requestId: 'lenta' }) });
      deliver(window, { source: peer, data: request({ requestId: 'rapida' }) });
      await settle();

      expect(peer.postMessage.mock.calls[0][0]).toMatchObject({
        requestId: 'rapida',
        result: 'segunda',
      });

      resolvePrimera('primera');
      await settle();

      expect(peer.postMessage.mock.calls[1][0]).toMatchObject({
        requestId: 'lenta',
        result: 'primera',
      });
    });

    it('rechaza una acción desconocida sin caerse', async () => {
      const peer = fakePeer();
      deliver(window, { source: peer, data: request({ action: 'BORRAR_TODO' }) });
      await settle();

      expect(peer.postMessage.mock.calls[0][0]).toMatchObject({
        ok: false,
        error: { code: ErrorCodes.UNKNOWN_ACTION },
      });
    });

    it('rechaza una versión de protocolo que no entiende', async () => {
      const peer = fakePeer();
      deliver(window, { source: peer, data: request({ version: 99 }) });
      await settle();

      expect(peer.postMessage.mock.calls[0][0]).toMatchObject({
        ok: false,
        error: { code: ErrorCodes.UNSUPPORTED_VERSION },
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('errores del handler', () => {
    it('deja pasar el mensaje de un error que el handler eligió emitir', async () => {
      const peer = fakePeer();
      handler.mockRejectedValue(
        new ExternalControlError(ErrorCodes.NOT_FOUND, 'ese estudio no existe')
      );

      deliver(window, { source: peer, data: request() });
      await settle();

      expect(peer.postMessage.mock.calls[0][0]).toMatchObject({
        ok: false,
        error: { code: ErrorCodes.NOT_FOUND, message: 'ese estudio no existe' },
      });
    });

    it('no filtra el mensaje de una excepción inesperada', async () => {
      // Puede traer rutas, UIDs o detalles del backend; el host no tiene por
      // qué verlos, y quien depura tiene la consola del visor.
      const peer = fakePeer();
      handler.mockRejectedValue(new Error('ENOENT /srv/pacs/secreto/1.2.3.dcm'));

      deliver(window, { source: peer, data: request() });
      await settle();

      const reply = peer.postMessage.mock.calls[0][0];
      expect(reply.error.code).toBe(ErrorCodes.INTERNAL);
      expect(reply.error.message).not.toContain('/srv/pacs');
    });

    it('sigue atendiendo después de que un handler falla', async () => {
      handler.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');

      deliver(window, { data: request() });
      await settle();
      const peer = fakePeer();
      deliver(window, { source: peer, data: request({ requestId: 'r2' }) });
      await settle();

      expect(peer.postMessage.mock.calls[0][0]).toMatchObject({ ok: true, result: 'ok' });
    });
  });

  describe('handshake', () => {
    it('contesta READY con las capacidades reales', async () => {
      const peer = fakePeer();
      deliver(window, {
        source: peer,
        data: request({ action: Actions.HANDSHAKE, requestId: 'hs' }),
      });
      await settle();

      expect(peer.postMessage.mock.calls[0][0]).toMatchObject({
        type: 'READY',
        requestId: 'hs',
        capabilities: [Actions.ADD_STUDIES],
      });
    });

    it('el handshake se contesta aunque no haya handlers registrados', async () => {
      const bare = new ExternalControlChannel({
        allowedOrigins: [ALLOWED],
        handlers: {},
        targetWindow: window,
        logger: silent,
      });
      bare.start();
      const peer = fakePeer();

      deliver(window, { source: peer, data: request({ action: Actions.HANDSHAKE }) });
      await settle();
      bare.stop();

      expect(peer.postMessage.mock.calls[0][0]).toMatchObject({ type: 'READY' });
    });

    it('anuncia READY a quien lo abrió, una vez por origen permitido', () => {
      const opener = fakePeer();
      const win = {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        opener,
      } as unknown as Window;

      new ExternalControlChannel({
        allowedOrigins: [ALLOWED, 'https://otro.example'],
        handlers: {},
        targetWindow: win,
        logger: silent,
      }).start();

      expect(opener.postMessage).toHaveBeenCalledTimes(2);
      // Nunca `*`: si el opener no es uno de estos, el navegador lo descarta.
      expect(opener.postMessage.mock.calls.map(call => call[1])).toEqual([
        ALLOWED,
        'https://otro.example',
      ]);
    });

    it('una ventana cerrada al responder no tumba el canal', async () => {
      const peer = {
        postMessage: jest.fn(() => {
          throw new Error('window is closed');
        }),
      } as unknown as Window & { postMessage: jest.Mock };

      deliver(window, { source: peer, data: request() });
      await settle();

      const vivo = fakePeer();
      deliver(window, { source: vivo, data: request({ requestId: 'r2' }) });
      await settle();

      expect(vivo.postMessage).toHaveBeenCalled();
    });
  });

  it('stop() deja de escuchar', async () => {
    channel.stop();

    deliver(window, { data: request() });
    await settle();

    expect(handler).not.toHaveBeenCalled();
  });
});
