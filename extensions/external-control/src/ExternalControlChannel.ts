/**
 * The viewer half of the channel: one `message` listener, an origin allowlist,
 * and a request/response correlation.
 *
 * It knows nothing about OHIF on purpose — it is handed a map of action name →
 * async handler and does the transport. That keeps the security-relevant part
 * (who may talk to us, and what we echo back) small enough to read in one
 * sitting and to test without a viewer.
 */

import {
  Actions,
  CHANNEL,
  ErrorCodes,
  ExternalControlError,
  MessageTypes,
  PROTOCOL_VERSION,
  type Ready,
  type Result,
} from './protocol';

type Handler = (payload: Record<string, unknown>) => Promise<unknown> | unknown;

type Options = {
  /** Exact origins, e.g. `https://ris.example.org`. `*` is refused. */
  allowedOrigins?: string[];
  handlers: Record<string, Handler>;
  /** Injected for tests; defaults to the real window. */
  targetWindow?: Window;
  logger?: Pick<Console, 'warn' | 'error'>;
};

export default class ExternalControlChannel {
  private readonly allowedOrigins: string[];
  private readonly handlers: Record<string, Handler>;
  private readonly window: Window;
  private readonly logger: Pick<Console, 'warn' | 'error'>;
  private listener?: (event: MessageEvent) => void;

  constructor({ allowedOrigins = [], handlers, targetWindow, logger = console }: Options) {
    this.window = targetWindow ?? (globalThis as unknown as Window);
    this.logger = logger;
    this.handlers = handlers;
    this.allowedOrigins = allowedOrigins.filter(origin => {
      if (typeof origin !== 'string' || origin === '' || origin === '*') {
        // A wildcard here would let any page that can get a handle on this
        // window drive it. There is no legitimate use for it, and silently
        // honouring it would be the worst possible default.
        this.logger.error(`[external-control] origen ignorado: ${String(origin)}`);
        return false;
      }
      return true;
    });
  }

  get capabilities(): string[] {
    return Object.keys(this.handlers);
  }

  get isEnabled(): boolean {
    return this.allowedOrigins.length > 0;
  }

  start(): void {
    if (this.listener) {
      return;
    }
    if (!this.isEnabled) {
      // Not an error: the extension ships in every build and stays inert until
      // a deployment names the origins it trusts.
      return;
    }
    this.listener = event => this.handleMessage(event);
    this.window.addEventListener('message', this.listener as EventListener);
    this.announceReady();
  }

  stop(): void {
    if (!this.listener) {
      return;
    }
    this.window.removeEventListener('message', this.listener as EventListener);
    this.listener = undefined;
  }

  /**
   * Tell whoever opened us that we are listening, once per allowed origin.
   *
   * Addressing each origin explicitly rather than `'*'` means the browser drops
   * the message unless the opener really is one of them, so a viewer opened
   * from an unexpected page announces nothing.
   */
  private announceReady(): void {
    const win = this.window as Window & { opener?: Window; parent?: Window };
    const targets = new Set<Window>();
    if (win.opener) {
      targets.add(win.opener);
    }
    if (win.parent && win.parent !== win) {
      targets.add(win.parent);
    }
    for (const target of targets) {
      for (const origin of this.allowedOrigins) {
        this.post(target, origin, this.readyMessage());
      }
    }
  }

  private readyMessage(requestId?: string): Ready {
    return {
      channel: CHANNEL,
      version: PROTOCOL_VERSION,
      type: MessageTypes.READY,
      capabilities: this.capabilities,
      ...(requestId ? { requestId } : {}),
    };
  }

  private post(target: Window, origin: string, message: Ready | Result): void {
    try {
      target.postMessage(message, origin);
    } catch (error) {
      // A closed or navigated-away window throws here. Nothing to do about it,
      // and it must not take down the listener.
      this.logger.warn('[external-control] no se pudo responder:', error);
    }
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    if (!this.allowedOrigins.includes(event.origin)) {
      return;
    }
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object' || data.channel !== CHANNEL) {
      return;
    }
    // Without a source there is nobody to answer, and no way to tell a real
    // window from a message forged through a shared worker or a broadcast.
    const source = event.source as Window | null;
    if (!source) {
      return;
    }
    // Our own outgoing messages come back when the host is an iframe on the
    // same page; they carry `type` and no `action`.
    if (typeof data.action !== 'string') {
      return;
    }

    const requestId = typeof data.requestId === 'string' ? data.requestId : undefined;
    const reply = (result: Omit<Result, 'channel' | 'version' | 'type' | 'requestId'>) =>
      this.post(source, event.origin, {
        channel: CHANNEL,
        version: PROTOCOL_VERSION,
        type: MessageTypes.RESULT,
        ...(requestId ? { requestId } : {}),
        ...result,
      });

    if (data.version !== PROTOCOL_VERSION) {
      reply({
        ok: false,
        error: {
          code: ErrorCodes.UNSUPPORTED_VERSION,
          message: `este visor habla la versión ${PROTOCOL_VERSION}`,
        },
      });
      return;
    }

    // The handshake is answered by the transport itself: a host that missed the
    // unprompted READY needs a way to ask for it, and it must work before any
    // handler is reachable.
    if (data.action === Actions.HANDSHAKE) {
      this.post(source, event.origin, this.readyMessage(requestId));
      return;
    }

    const handler = this.handlers[data.action];
    if (!handler) {
      reply({
        ok: false,
        error: {
          code: ErrorCodes.UNKNOWN_ACTION,
          message: `acción desconocida: ${data.action}`,
        },
      });
      return;
    }

    const payload =
      data.payload && typeof data.payload === 'object'
        ? (data.payload as Record<string, unknown>)
        : {};

    try {
      const result = await handler(payload);
      reply({ ok: true, result: result ?? null });
    } catch (error) {
      // Only an error the handler chose to raise gets its message forwarded.
      // Anything else is reported as INTERNAL and logged locally, because an
      // unexpected exception can carry internals the host should not read.
      if (error instanceof ExternalControlError) {
        reply({ ok: false, error: { code: error.code, message: error.message } });
        return;
      }
      this.logger.error(`[external-control] ${data.action} falló:`, error);
      reply({
        ok: false,
        error: { code: ErrorCodes.INTERNAL, message: 'la acción falló en el visor' },
      });
    }
  }
}
