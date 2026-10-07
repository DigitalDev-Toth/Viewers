/**
 * The wire contract between a host application and a viewer window.
 *
 * Everything here is shared by both ends, so it is deliberately data-only —
 * no imports, no DOM, no OHIF. `public/external-control/client.js` repeats
 * these few string constants rather than importing them, because it has to run
 * as a plain <script> in a host application that knows nothing about this
 * build; `protocol.test.ts` asserts the two copies never drift.
 */

/** Discriminates our traffic from every other postMessage on the page. */
export const CHANNEL = 'ohif-external-control';

/**
 * Bumped only on a breaking change. The viewer answers a request whose version
 * it does not recognise with an error instead of guessing.
 */
export const PROTOCOL_VERSION = 1;

/** Host → viewer. */
export const Actions = {
  /** Ask the viewer to identify itself; answered with a READY message. */
  HANDSHAKE: 'HANDSHAKE',
  /** Load one or more studies into the running session. */
  ADD_STUDIES: 'ADD_STUDIES',
  /** Drop a study's display sets and free its images. */
  REMOVE_STUDIES: 'REMOVE_STUDIES',
  /** Bring the window forward and hang a study or display set. */
  FOCUS: 'FOCUS',
  /** Split the grid into rows × columns, filling new viewports with series. */
  SET_LAYOUT: 'SET_LAYOUT',
  /**
   * Reload the viewer through its own `/open` link — the one way to hand it new
   * credentials when the host holds no window handle to navigate.
   */
  RELOAD_SESSION: 'RELOAD_SESSION',
  /** Read back what the session holds, so the host can reconcile. */
  GET_SESSION_STATE: 'GET_SESSION_STATE',
  /** Escape hatch onto the commands manager; off unless configured on. */
  RUN_COMMANDS: 'RUN_COMMANDS',
} as const;

/** Viewer → host. */
export const MessageTypes = {
  /** The viewer is listening. Sent unprompted at start-up and on HANDSHAKE. */
  READY: 'READY',
  /** The answer to one request, correlated by `requestId`. */
  RESULT: 'RESULT',
} as const;

export const ErrorCodes = {
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL: 'INTERNAL',
} as const;

export type Action = (typeof Actions)[keyof typeof Actions];
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export type Request = {
  channel: typeof CHANNEL;
  version: number;
  requestId?: string;
  action: Action;
  payload?: Record<string, unknown>;
  /** Bus only: the origin the request comes from, as the browser reported it. */
  origin?: string;
  /** Bus only, on HANDSHAKE: the window name of the viewer being looked for. */
  target?: string;
  /** Bus only, after the handshake: the viewer instance the host settled on. */
  instance?: string;
};

export type Result = {
  channel: typeof CHANNEL;
  version: number;
  type: typeof MessageTypes.RESULT;
  requestId?: string;
  /** Which viewer page load answered. */
  instance?: string;
  ok: boolean;
  result?: unknown;
  error?: { code: ErrorCode; message: string };
};

export type Ready = {
  channel: typeof CHANNEL;
  version: number;
  type: typeof MessageTypes.READY;
  /** Which actions this viewer will actually accept, after configuration. */
  capabilities: string[];
  /** The viewer window's name, which is what hosts address it by. */
  viewerId?: string;
  /** Different on every page load; see ExternalControlChannel.instance. */
  instance?: string;
  /** Echoed from the HANDSHAKE that triggered it, if any. */
  requestId?: string;
};

/**
 * An error a handler can raise to pick the code the host sees. Anything else
 * thrown becomes INTERNAL, and its message is not forwarded — an unexpected
 * exception can carry paths or identifiers that the host has no business
 * seeing.
 */
export class ExternalControlError extends Error {
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ExternalControlError';
    this.code = code;
  }
}
