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
 *
 * - **The viewer may have been opened by another tab.** The browser only lets
 *   `window.open('', name)` find windows in this page's own browsing-context
 *   group, so a worklist tab opened by hand cannot find the viewer another tab
 *   opened. Before touching any window, the client asks over a
 *   BroadcastChannel of the viewer's origin — directly when this page is on
 *   that origin, through a hidden `external-control/bridge.html` iframe
 *   otherwise — and if a viewer by that name answers, talks to it there.
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
    /** Look for an open viewer over the bus before opening windows. */
    bus: true,
    /** How long to listen on the bus before deciding nobody is there. */
    busProbeMs: 1500,
  };

  function copy(message) {
    var out = {};
    for (var key in message) {
      out[key] = message[key];
    }
    return out;
  }

  /**
   * The bus: a BroadcastChannel when this page shares the viewer's origin, the
   * bridge iframe otherwise. Either way the same three operations.
   */
  function createBus(client) {
    var viewerOrigin = client.settings.viewerOrigin;
    if (typeof BroadcastChannel !== 'function') {
      return null;
    }

    if (window.location.origin === viewerOrigin) {
      var channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = function (event) {
        client.handleBusData(event.data);
      };
      return {
        post: function (message) {
          var stamped = copy(message);
          // Same origin: there is no bridge to state it for us.
          stamped.origin = window.location.origin;
          channel.postMessage(stamped);
        },
        isSource: function () {
          return false;
        },
        destroy: function () {
          channel.close();
        },
      };
    }

    var frame = document.createElement('iframe');
    frame.style.display = 'none';
    frame.setAttribute('aria-hidden', 'true');
    frame.title = 'OHIF external control';
    frame.src = viewerOrigin + '/external-control/bridge.html';
    var loaded = false;
    var waiting = [];
    function deliver(message) {
      try {
        frame.contentWindow.postMessage(message, viewerOrigin);
      } catch (e) {
        /* the frame is gone; the caller times out */
      }
    }
    frame.addEventListener('load', function () {
      loaded = true;
      waiting.splice(0).forEach(deliver);
    });
    (document.body || document.documentElement).appendChild(frame);

    return {
      post: function (message) {
        if (loaded) {
          deliver(message);
        } else {
          waiting.push(message);
        }
      },
      isSource: function (source) {
        return source === frame.contentWindow;
      },
      destroy: function () {
        if (frame.parentNode) {
          frame.parentNode.removeChild(frame);
        }
      },
    };
  }

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
    /** 'window' or 'bus': how the viewer we are talking to was reached. */
    this.via = null;
    /** Bus only: the viewer page load we settled on. */
    this.instance = null;

    var self = this;
    this.onMessage = function (event) {
      self.handleMessage(event);
    };
    window.addEventListener('message', this.onMessage);
    this.bus = settings.bus ? (options.createBus || createBus)(this) : null;
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
    if (this.bus && event.source && this.bus.isSource(event.source)) {
      this.handleBusData(data);
      return;
    }

    if (data.type === 'READY') {
      // Trust the window that actually answered, not the one we think we
      // opened: a reattach by name can hand us a different proxy.
      this.onReady(data, 'window', event.source);
      return;
    }

    if (data.type === 'RESULT') {
      this.handleResult(data);
    }
  };

  /**
   * Traffic off the bus. Every viewer window in the browser is on it, so a
   * READY counts only from the one with our window name, and once settled on
   * a page load we stay with it — unless that same name announces itself
   * unprompted, which is the viewer having been reloaded under us.
   */
  ExternalControlClient.prototype.handleBusData = function (data) {
    if (!data || typeof data !== 'object' || data.channel !== CHANNEL) {
      return;
    }
    if (data.type === 'READY') {
      if (data.viewerId !== this.settings.windowName) {
        return;
      }
      if (this.connected && this.via === 'bus' && data.instance !== this.instance) {
        if (!data.requestId) {
          this.instance = data.instance;
        }
        return;
      }
      if (this.connected && this.via === 'window') {
        return;
      }
      this.onReady(data, 'bus', null);
      return;
    }
    if (data.type === 'RESULT') {
      this.handleResult(data);
    }
  };

  ExternalControlClient.prototype.onReady = function (data, via, source) {
    if (source) {
      this.viewerWindow = source;
    }
    if (!this.connected) {
      this.via = via;
      this.instance = data.instance || null;
    }
    this.capabilities = data.capabilities || [];
    this.stopHandshake();
    this.rememberOpened();
    var wasConnected = this.connected;
    this.connected = true;
    this.flush();
    if (!wasConnected) {
      this.emit('ready', { capabilities: this.capabilities, via: this.via });
    }
  };

  ExternalControlClient.prototype.handleResult = function (data) {
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
  };

  ExternalControlClient.prototype.stopHandshake = function () {
    clearInterval(this.handshakeTimer);
    clearTimeout(this.giveUpTimer);
    this.handshakeTimer = null;
    this.giveUpTimer = null;
  };

  ExternalControlClient.prototype.postBusHandshake = function () {
    if (this.bus) {
      this.bus.post({
        channel: CHANNEL,
        version: PROTOCOL_VERSION,
        action: 'HANDSHAKE',
        target: this.settings.windowName,
      });
    }
  };

  ExternalControlClient.prototype.postHandshake = function () {
    this.postBusHandshake();
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
   *
   * Before any of that, a viewer by this window name is looked for on the
   * bus; if one answers, no window is opened or touched. A host that handed a
   * window over can tell by `client.via === 'bus'` that it went unused.
   */
  ExternalControlClient.prototype.open = function (url, options) {
    var self = this;
    var force = Boolean(options && options.force);
    var closed = this.viewerWindow && this.viewerWindow.closed;
    // Connected through a window, but holding none: nothing left to talk to.
    var orphaned = this.connected && this.via === 'window' && !this.viewerWindow;
    if (closed || orphaned) {
      // The radiologist closed the viewer, or the reference to it was lost.
      // Whatever we were connected to is gone: without this, open() would
      // resolve on the stale connection and the window it then finds by name
      // is a blank one it never navigates.
      this.forgetViewer();
    }
    var handle = this.viewerWindow && !this.viewerWindow.closed;

    if (this.connected && this.via === 'bus' && !handle) {
      if (!force) {
        return Promise.resolve(this);
      }
      return this.reloadOverBus(url || this.settings.openUrl);
    }
    if (force || !this.bus || this.connected) {
      return this.openWindow(url, options);
    }
    return this.probeBus().then(function (found) {
      return found ? self : self.openWindow(url, options);
    });
  };

  /** Ask on the bus whether a viewer by our window name is out there. */
  ExternalControlClient.prototype.probeBus = function () {
    var self = this;
    if (this.connected) {
      return Promise.resolve(true);
    }
    return new Promise(function (resolve) {
      var interval = null;
      var timer = null;
      function finish(found) {
        clearInterval(interval);
        clearTimeout(timer);
        self.off('ready', onReady);
        resolve(found);
      }
      function onReady() {
        finish(true);
      }
      self.on('ready', onReady);
      self.postBusHandshake();
      interval = setInterval(function () {
        self.postBusHandshake();
      }, self.settings.handshakeIntervalMs);
      timer = setTimeout(function () {
        finish(self.connected);
      }, self.settings.busProbeMs);
    });
  };

  /**
   * Reload a viewer we only know through the bus. With no handle to navigate,
   * the viewer is asked to do it itself; it only accepts its own `/open` link.
   */
  ExternalControlClient.prototype.reloadOverBus = function (openUrl) {
    var self = this;
    return this.send('RELOAD_SESSION', { url: openUrl }).then(function () {
      self.connected = false;
      self.instance = null;
      return self.waitForReady(openUrl, { alreadyNavigated: true });
    });
  };

  ExternalControlClient.prototype.openWindow = function (url, options) {
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
    if (this.via === 'bus' && this.bus) {
      var pinned = copy(message);
      pinned.instance = this.instance;
      this.bus.post(pinned);
      return;
    }
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

      var reachable =
        self.via === 'bus' || (self.viewerWindow && !self.viewerWindow.closed);
      if (self.connected && reachable) {
        self.transmit(message);
      } else {
        self.queue.push(message);
      }
    });
  };

  /**
   * `{focus: true}` shows the first one; `{prefetch: true}` also downloads
   * their images in the background, so that switching to them later is
   * immediate. Without it only the metadata comes: images load when shown.
   */
  ExternalControlClient.prototype.addStudies = function (studies, options) {
    var payload = { studies: studies };
    if (options && options.focus) {
      payload.focus = true;
    }
    if (options && options.prefetch) {
      payload.prefetch = true;
    }
    return this.send('ADD_STUDIES', payload);
  };

  /** Background download for studies already added; progress in getSessionState(). */
  ExternalControlClient.prototype.prefetchStudies = function (studies) {
    return this.send('PREFETCH_STUDIES', { studies: studies });
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

  /**
   * The hanging protocols that apply to a study, with their stages, and the
   * study's main modality: `{modality, protocols: [{id, name, stages: [{id, name}]}]}`.
   */
  ExternalControlClient.prototype.getHangingProtocols = function (target) {
    return this.send('GET_HANGING_PROTOCOLS', target || {});
  };

  /**
   * `{StudyInstanceUID, protocolId?, stageId?}`: hang the study that way, or,
   * without protocolId, the way OHIF chooses on its own.
   */
  ExternalControlClient.prototype.setHangingProtocol = function (target) {
    return this.send('SET_HANGING_PROTOCOL', target || {});
  };

  ExternalControlClient.prototype.getSessionState = function () {
    return this.send('GET_SESSION_STATE', {});
  };

  /** Only answered when the viewer was configured with `allowRunCommands`. */
  ExternalControlClient.prototype.runCommands = function (commands) {
    return this.send('RUN_COMMANDS', { commands: commands });
  };

  /** Drop every trace of the viewer we were talking to. */
  ExternalControlClient.prototype.forgetViewer = function () {
    this.stopHandshake();
    this.connected = false;
    this.viewerWindow = null;
    this.via = null;
    this.instance = null;
    try {
      window.localStorage.removeItem(this.storageKey());
    } catch (e) {
      /* see rememberOpened */
    }
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
    if (this.bus) {
      this.bus.destroy();
      this.bus = null;
    }
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
