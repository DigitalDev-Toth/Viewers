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

/**
 * `https://*.example.org` — one subdomain label, never more, never none.
 *
 * The suffix needs at least two labels so `https://*.org` cannot slip through,
 * and the scheme and port are fixed, so the pattern widens the host and
 * nothing else.
 */
const SUBDOMAIN_PATTERN = /^(https?):\/\/\*((?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){2,})(:\d+)?$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type SubdomainRule = { prefix: string; suffix: string };

type Options = {
  /**
   * Exact origins, e.g. `https://ris.example.org`, or a single-label subdomain
   * pattern, `https://*.example.org`. A bare `*` is refused.
   */
  allowedOrigins?: string[];
  handlers: Record<string, Handler>;
  /** Injected for tests; defaults to the real window. */
  targetWindow?: Window;
  logger?: Pick<Console, 'warn' | 'error'>;
};

export default class ExternalControlChannel {
  private readonly allowedOrigins: string[];
  private readonly subdomainRules: SubdomainRule[] = [];
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
      if (origin.includes('*')) {
        // One RIS serving many centres, each on its own subdomain, is the
        // case for a pattern. Anything looser than one label under a fixed
        // domain is refused rather than guessed at.
        const match = SUBDOMAIN_PATTERN.exec(origin.toLowerCase());
        if (!match) {
          this.logger.error(`[external-control] patrón de origen ignorado: ${origin}`);
        } else {
          const [, scheme, domain, port = ''] = match;
          this.subdomainRules.push({ prefix: `${scheme}://`, suffix: `${domain}${port}` });
        }
        return false;
      }
      return true;
    });
  }

  isAllowedOrigin(origin: string): boolean {
    if (this.allowedOrigins.includes(origin)) {
      return true;
    }
    return this.subdomainRules.some(({ prefix, suffix }) => {
      if (!origin.startsWith(prefix) || !origin.endsWith(suffix)) {
        return false;
      }
      const label = origin.slice(prefix.length, origin.length - suffix.length);
      return LABEL.test(label);
    });
  }

  get capabilities(): string[] {
    return Object.keys(this.handlers);
  }

  get isEnabled(): boolean {
    return this.allowedOrigins.length > 0 || this.subdomainRules.length > 0;
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
   *
   * Subdomain patterns cannot be addressed this way — the opener's origin is
   * not readable across origins — so those hosts are not announced to. They
   * do not need it: the client keeps sending HANDSHAKE until it is answered,
   * and that answer goes to the exact origin that asked.
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
    if (!this.isAllowedOrigin(event.origin)) {
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
