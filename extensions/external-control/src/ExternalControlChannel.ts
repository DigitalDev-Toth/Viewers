/**
 * The viewer half of the channel: an origin allowlist, a request/response
 * correlation, and two ways in.
 *
 * - `postMessage` on the window, from whoever holds a handle to it (the page
 *   that opened it, or one that found it by name).
 * - A `BroadcastChannel` on the viewer's own origin, from a page that holds no
 *   handle at all. Browsers only let `window.open('', name)` find windows in
 *   the caller's own browsing-context group, so a worklist tab opened by hand
 *   can never reach a viewer another tab opened. The bus reaches every viewer
 *   window of this origin in the browser; a host on another origin talks to it
 *   through `external-control/bridge.html`, which it embeds hidden.
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

/**
 * The bus is same-origin only, so whoever writes to it runs our code. Pages
 * that relay for another origin (the bridge) state that origin in `origin`,
 * taken from the browser's own MessageEvent, and it is checked like any other.
 */
type BusLike = {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close?(): void;
};

type Reply = (message: Ready | Result) => void;

type Options = {
  /**
   * Exact origins, e.g. `https://ris.example.org`, or a single-label subdomain
   * pattern, `https://*.example.org`. A bare `*` is refused.
   */
  allowedOrigins?: string[];
  handlers: Record<string, Handler>;
  /** Injected for tests; defaults to the real window. */
  targetWindow?: Window;
  /**
   * Injected for tests; defaults to a BroadcastChannel named after CHANNEL.
   * `null` turns the bus off.
   */
  createBus?: (() => BusLike) | null;
  logger?: Pick<Console, 'warn' | 'error'>;
};

export default class ExternalControlChannel {
  private readonly allowedOrigins: string[];
  private readonly subdomainRules: SubdomainRule[] = [];
  private readonly handlers: Record<string, Handler>;
  private readonly window: Window;
  private readonly logger: Pick<Console, 'warn' | 'error'>;
  private listener?: (event: MessageEvent) => void;
  private readonly createBus: (() => BusLike) | null;
  private bus?: BusLike;
  private busListener?: (event: MessageEvent) => void;
  /**
   * Different on every page load. A host that found this viewer over the bus
   * pins its requests to it, so a second window answering to the same name —
   * possible across browsing-context groups — never runs the same action.
   */
  readonly instance = Math.random().toString(36).slice(2) + Date.now().toString(36);

  constructor({
    allowedOrigins = [],
    handlers,
    targetWindow,
    logger = console,
    createBus,
  }: Options) {
    this.window = targetWindow ?? (globalThis as unknown as Window);
    this.createBus =
      createBus !== undefined
        ? createBus
        : typeof BroadcastChannel === 'function'
          ? () => new BroadcastChannel(CHANNEL) as unknown as BusLike
          : null;
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
    this.startBus();
    this.announceReady();
  }

  stop(): void {
    if (!this.listener) {
      return;
    }
    this.window.removeEventListener('message', this.listener as EventListener);
    this.listener = undefined;
    if (this.bus && this.busListener) {
      this.bus.removeEventListener('message', this.busListener);
      this.bus.close?.();
    }
    this.bus = undefined;
    this.busListener = undefined;
  }

  private startBus(): void {
    if (!this.createBus) {
      return;
    }
    try {
      this.bus = this.createBus();
    } catch (error) {
      this.logger.warn('[external-control] sin bus entre pestañas:', error);
      return;
    }
    this.busListener = event => this.handleBusMessage(event);
    this.bus.addEventListener('message', this.busListener);
    // A host waiting on the bus — the viewer was reloaded under it, say —
    // learns the new instance without having to ask.
    this.postToBus(this.readyMessage());
  }

  /** The name hosts address this window by; read late, it can be renamed. */
  private get viewerId(): string {
    try {
      return this.window.name ?? '';
    } catch {
      return '';
    }
  }

  private postToBus(message: Ready | Result): void {
    try {
      this.bus?.postMessage(message);
    } catch (error) {
      this.logger.warn('[external-control] no se pudo responder por el bus:', error);
    }
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
      viewerId: this.viewerId,
      instance: this.instance,
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

  private handleMessage(event: MessageEvent): void {
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
    void this.dispatch(data, message => this.post(source, event.origin, message));
  }

  /**
   * A request off the bus. The bus spans every viewer window in the browser,
   * so beyond the origin check this also decides whether the request is for
   * *this* window: a handshake by name, everything else by instance.
   */
  private handleBusMessage(event: MessageEvent): void {
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object' || data.channel !== CHANNEL) {
      return;
    }
    const origin = data.origin;
    if (typeof origin !== 'string' || !this.isAllowedOrigin(origin)) {
      return;
    }
    if (data.action === Actions.HANDSHAKE) {
      // No target means "whoever is out there": every viewer answers, and the
      // host picks. A target that is not us is someone else's handshake.
      if (typeof data.target === 'string' && data.target !== this.viewerId) {
        return;
      }
    } else if (data.instance !== this.instance) {
      return;
    }
    void this.dispatch(data, message => this.postToBus(message));
  }

  private async dispatch(data: Record<string, unknown>, send: Reply): Promise<void> {
    // Our own outgoing messages come back when the host is an iframe on the
    // same page, and every viewer's answers travel the bus; they carry `type`
    // and no `action`.
    if (typeof data.action !== 'string') {
      return;
    }

    const requestId = typeof data.requestId === 'string' ? data.requestId : undefined;
    const reply = (result: Omit<Result, 'channel' | 'version' | 'type' | 'requestId'>) =>
      send({
        channel: CHANNEL,
        version: PROTOCOL_VERSION,
        type: MessageTypes.RESULT,
        instance: this.instance,
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
      send(this.readyMessage(requestId));
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
