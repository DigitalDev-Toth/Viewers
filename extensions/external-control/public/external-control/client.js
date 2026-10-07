/**
 * Host-side client for the OHIF external-control channel.
 *
 * Drop it into the application that owns the worklist:
 *
 *   <script src="https://viewer.example.org/external-control/client.js"></script>
 *   <script>
 *     const viewer = OHIFExternalControl.connect({
 *       viewerOrigin: 'https://viewer.example.org',
 *       openUrl: 'https://viewer.example.org/',
 *     });
 *     button.onclick = () => viewer.addStudies([{ StudyInstanceUID: uid }]);
 *   </script>
 *
 * It is a plain script with no dependencies and no build step, because the host
 * is usually a server-rendered application that will not be adding a bundler
 * for this.
 *
 * What it takes care of, and why:
 *
 * - **The window may already be open.** A worklist is a multi-page app: every
 *   navigation loses the `window` reference, but the viewer next to it is still
 *   running. Re-opening it by URL would throw away the session, so the client
 *   reattaches by window name and only navigates when a handshake proves
 *   nothing is listening there. `window.open('', name)` conjures a blank window
 *   when none exists, so "it returned a window" is not evidence of a viewer.
 *
 * - **Messages sent too early are lost.** postMessage has no buffering, so
 *   anything sent before the viewer's listener exists disappears without a
 *   trace. Calls are queued until READY and flushed then.
 *
 * - **Answers must be matched to questions.** Every request carries a
 *   `requestId` and resolves its own promise, so two overlapping calls cannot
 *   collect each other's result.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OHIFExternalControl = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Kept in sync with src/protocol.ts by protocol.test.ts.
  var CHANNEL = 'ohif-external-control';
  var PROTOCOL_VERSION = 1;

  var DEFAULTS = {
    windowName: 'ohif-viewer',
    /** How long a silent window gets before we decide it is not a viewer. */
    handshakeTimeoutMs: 2500,
    /** How often to re-announce ourselves while waiting. */
    handshakeIntervalMs: 250,
    /** How long any one action may take before the promise rejects. */
    requestTimeoutMs: 60000,
    windowFeatures: '',
  };

  function ExternalControlClient(options) {
    var settings = {};
    for (var key in DEFAULTS) {
      settings[key] = options[key] !== undefined ? options[key] : DEFAULTS[key];
    }
    if (!options.viewerOrigin) {
      throw new Error('OHIFExternalControl: falta viewerOrigin');
    }
    settings.viewerOrigin = options.viewerOrigin;
    settings.openUrl = options.openUrl || options.viewerOrigin;

    this.settings = settings;
    this.viewerWindow = null;
    this.connected = false;
    this.capabilities = [];
    this.pending = {};
    this.queue = [];
    this.listeners = { ready: [], disconnect: [] };
    this.nextId = 0;
    this.handshakeTimer = null;
    this.giveUpTimer = null;

    var self = this;
    this.onMessage = function (event) {
      self.handleMessage(event);
    };
    window.addEventListener('message', this.onMessage);
  }

  /** Remembering that we opened it lets a later page skip the handshake wait. */
  ExternalControlClient.prototype.storageKey = function () {
    return 'ohif-external-control:' + this.settings.windowName;
  };

  ExternalControlClient.prototype.rememberOpened = function () {
    try {
      window.localStorage.setItem(this.storageKey(), String(Date.now()));
    } catch (e) {
      /* private mode, or storage disabled — we just lose the shortcut */
    }
  };

  ExternalControlClient.prototype.mayBeOpen = function () {
    try {
      var at = Number(window.localStorage.getItem(this.storageKey()));
      // A shift, roughly. Older than that and it is cheaper to assume the
      // window is gone than to make the user wait for a handshake to fail.
      return Boolean(at) && Date.now() - at < 12 * 60 * 60 * 1000;
    } catch (e) {
      return false;
    }
  };

  ExternalControlClient.prototype.on = function (eventName, callback) {
    (this.listeners[eventName] || (this.listeners[eventName] = [])).push(callback);
    return this;
  };

  ExternalControlClient.prototype.off = function (eventName, callback) {
    this.listeners[eventName] = (this.listeners[eventName] || []).filter(function (registered) {
      return registered !== callback;
    });
    return this;
  };

  ExternalControlClient.prototype.once = function (eventName, callback) {
    var self = this;
    function wrapped(payload) {
      self.off(eventName, wrapped);
      callback(payload);
    }
    return this.on(eventName, wrapped);
  };

  ExternalControlClient.prototype.emit = function (eventName, payload) {
    (this.listeners[eventName] || []).forEach(function (callback) {
      try {
        callback(payload);
      } catch (e) {
        console.error('[external-control] listener falló:', e);
      }
    });
  };

  ExternalControlClient.prototype.handleMessage = function (event) {
    if (event.origin !== this.settings.viewerOrigin) {
      return;
    }
    var data = event.data;
    if (!data || typeof data !== 'object' || data.channel !== CHANNEL) {
      return;
    }

    if (data.type === 'READY') {
      // Trust the window that actually answered, not the one we think we
      // opened: a reattach by name can hand us a different proxy.
      if (event.source) {
        this.viewerWindow = event.source;
      }
      this.capabilities = data.capabilities || [];
      this.stopHandshake();
      this.rememberOpened();
      var wasConnected = this.connected;
      this.connected = true;
      this.flush();
      if (!wasConnected) {
        this.emit('ready', { capabilities: this.capabilities });
      }
      return;
    }

    if (data.type === 'RESULT') {
      var entry = this.pending[data.requestId];
      if (!entry) {
        return;
      }
      delete this.pending[data.requestId];
      clearTimeout(entry.timer);
      if (data.ok) {
        entry.resolve(data.result);
      } else {
        var error = new Error((data.error && data.error.message) || 'la acción falló');
        error.code = (data.error && data.error.code) || 'INTERNAL';
        entry.reject(error);
      }
    }
  };

  ExternalControlClient.prototype.stopHandshake = function () {
    clearInterval(this.handshakeTimer);
    clearTimeout(this.giveUpTimer);
    this.handshakeTimer = null;
    this.giveUpTimer = null;
  };

  ExternalControlClient.prototype.postHandshake = function () {
    if (!this.viewerWindow) {
      return;
    }
    try {
      this.viewerWindow.postMessage(
        {
          channel: CHANNEL,
          version: PROTOCOL_VERSION,
          action: 'HANDSHAKE',
        },
        this.settings.viewerOrigin
      );
    } catch (e) {
      /* the window went away between the check and the post */
    }
  };

  /**
   * Open the viewer, or reattach to the one already open.
   *
   * Must be called from a user gesture the first time: `window.open` outside
   * one is blocked, and there is no way to recover from that programmatically.
   *
   * `{force: true}` reloads the window even if a viewer is answering in it.
   * That throws away the session, so it is only for when the host knows the
   * running one cannot serve what it is about to ask — a viewer opened earlier
   * with narrower credentials, typically.
   *
   * `{reattach: true}` tries the window by name first even when this page has
   * no record of opening it — for when the host knows a window by that name
   * is out there because another page of it opened one (with a plain
   * `window.open(url, name)`, say). Without it, that window would be
   * navigated and its session lost.
   *
   * `{window: handle}` uses a window the host already opened instead of
   * calling `window.open` here. The point is the user gesture: a host that
   * has to ask its backend before it knows what to send can open (or find)
   * the named window synchronously in the click, and hand it over once the
   * answer arrives — by then the gesture is long gone and a `window.open` of
   * our own could be blocked.
   */
  ExternalControlClient.prototype.open = function (url, options) {
    var openUrl = url || this.settings.openUrl;
    var force = Boolean(options && options.force);
    var reattach = Boolean(options && options.reattach);
    var alive = this.viewerWindow && !this.viewerWindow.closed;

    if (alive && !force) {
      if (this.connected) {
        try {
          this.viewerWindow.focus();
        } catch (e) {
          /* the browser declined to raise it */
        }
        return Promise.resolve(this);
      }
      return this.waitForReady(openUrl);
    }

    if (alive && force) {
      this.connected = false;
      try {
        this.viewerWindow.location.href = openUrl;
      } catch (e) {
        return Promise.reject(withCode(e, 'VIEWER_UNREACHABLE'));
      }
      return this.waitForReady(openUrl, { alreadyNavigated: true });
    }

    // Reattach blind when there is reason to believe a viewer is out there;
    // otherwise go straight to the URL and skip the handshake timeout.
    var target = !force && (reattach || this.mayBeOpen()) ? '' : openUrl;
    var handed = options && options.window;
    if (handed && !handed.closed) {
      this.viewerWindow = handed;
      if (target !== '') {
        try {
          handed.location.href = target;
        } catch (e) {
          return Promise.reject(withCode(e, 'VIEWER_UNREACHABLE'));
        }
      }
    } else {
      this.viewerWindow = window.open(target, this.settings.windowName, this.settings.windowFeatures);
    }

    if (!this.viewerWindow) {
      var blocked = new Error('el navegador bloqueó la ventana del visor');
      blocked.code = 'POPUP_BLOCKED';
      return Promise.reject(blocked);
    }

    return this.waitForReady(openUrl, { alreadyNavigated: target !== '' });
  };

  ExternalControlClient.prototype.waitForReady = function (openUrl, options) {
    if (this.connected) {
      return Promise.resolve(this);
    }
    var self = this;

    return new Promise(function (resolve, reject) {
      var settled = false;
      // When the caller already pointed the window at the viewer, a second
      // navigation would only restart a load that is already under way.
      var navigated = Boolean(options && options.alreadyNavigated);

      function done(error) {
        if (settled) {
          return;
        }
        settled = true;
        self.stopHandshake();
        if (error) {
          reject(error);
        } else {
          resolve(self);
        }
      }

      function ping() {
        self.stopHandshake();
        self.postHandshake();
        self.handshakeTimer = setInterval(function () {
          self.postHandshake();
        }, self.settings.handshakeIntervalMs);
      }

      function onDeadline() {
        if (self.connected) {
          done();
          return;
        }
        if (navigated) {
          done(withCode(new Error('el visor no respondió'), 'VIEWER_UNREACHABLE'));
          return;
        }
        // Nothing answered. Either we reattached to a blank window this very
        // call conjured, or whatever is in it is not a viewer. Point it at the
        // viewer and wait once more — the only place the client navigates a
        // window it did not just create, and the reason the wait exists at all.
        navigated = true;
        try {
          self.viewerWindow.location.href = openUrl;
        } catch (e) {
          done(withCode(e, 'VIEWER_UNREACHABLE'));
          return;
        }
        ping();
        // A cold viewer has a bundle to fetch and a mode to mount.
        self.giveUpTimer = setTimeout(onDeadline, self.settings.handshakeTimeoutMs * 4);
      }

      self.once('ready', function () {
        done();
      });

      ping();
      // A cold viewer has a bundle to fetch and a mode to mount, so a window
      // we just navigated gets the long deadline from the start.
      self.giveUpTimer = setTimeout(
        onDeadline,
        navigated ? self.settings.handshakeTimeoutMs * 4 : self.settings.handshakeTimeoutMs
      );
    });
  };

  function withCode(error, code) {
    error.code = code;
    return error;
  }

  ExternalControlClient.prototype.flush = function () {
    var queued = this.queue;
    this.queue = [];
    var self = this;
    queued.forEach(function (message) {
      self.transmit(message);
    });
  };

  ExternalControlClient.prototype.transmit = function (message) {
    try {
      this.viewerWindow.postMessage(message, this.settings.viewerOrigin);
    } catch (e) {
      var entry = this.pending[message.requestId];
      if (entry) {
        delete this.pending[message.requestId];
        clearTimeout(entry.timer);
        entry.reject(withCode(e, 'VIEWER_UNREACHABLE'));
      }
    }
  };

  /** Send one action. Queued if the viewer has not said READY yet. */
  ExternalControlClient.prototype.send = function (action, payload) {
    var self = this;
    var requestId = String(++this.nextId) + '-' + String(Date.now());
    var message = {
      channel: CHANNEL,
      version: PROTOCOL_VERSION,
      requestId: requestId,
      action: action,
      payload: payload || {},
    };

    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        delete self.pending[requestId];
        self.queue = self.queue.filter(function (queued) {
          return queued.requestId !== requestId;
        });
        reject(withCode(new Error('el visor no contestó a ' + action), 'TIMEOUT'));
      }, self.settings.requestTimeoutMs);

      self.pending[requestId] = { resolve: resolve, reject: reject, timer: timer };

      if (self.connected && self.viewerWindow && !self.viewerWindow.closed) {
        self.transmit(message);
      } else {
        self.queue.push(message);
      }
    });
  };

  ExternalControlClient.prototype.addStudies = function (studies, options) {
    var payload = { studies: studies };
    if (options && options.focus) {
      payload.focus = true;
    }
    return this.send('ADD_STUDIES', payload);
  };

  ExternalControlClient.prototype.removeStudies = function (studies) {
    return this.send('REMOVE_STUDIES', { studies: studies });
  };

  ExternalControlClient.prototype.focus = function (target) {
    return this.send('FOCUS', target || {});
  };

  /** Rows × columns; the viewer fills new viewports with series not on screen. */
  ExternalControlClient.prototype.setLayout = function (numRows, numCols) {
    return this.send('SET_LAYOUT', { numRows: numRows, numCols: numCols });
  };

  ExternalControlClient.prototype.getSessionState = function () {
    return this.send('GET_SESSION_STATE', {});
  };

  /** Only answered when the viewer was configured with `allowRunCommands`. */
  ExternalControlClient.prototype.runCommands = function (commands) {
    return this.send('RUN_COMMANDS', { commands: commands });
  };

  ExternalControlClient.prototype.close = function () {
    this.stopHandshake();
    if (this.viewerWindow) {
      try {
        this.viewerWindow.close();
      } catch (e) {
        /* nothing to do */
      }
    }
    this.connected = false;
    this.viewerWindow = null;
    try {
      window.localStorage.removeItem(this.storageKey());
    } catch (e) {
      /* see rememberOpened */
    }
    this.emit('disconnect', {});
  };

  /** Stop listening. The viewer window is left alone. */
  ExternalControlClient.prototype.destroy = function () {
    this.stopHandshake();
    window.removeEventListener('message', this.onMessage);
  };

  return {
    CHANNEL: CHANNEL,
    PROTOCOL_VERSION: PROTOCOL_VERSION,
    connect: function (options) {
      return new ExternalControlClient(options || {});
    },
  };
});
