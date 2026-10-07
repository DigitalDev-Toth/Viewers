/**
 * Relay between a host page on another origin and the viewer windows of this
 * origin, over a BroadcastChannel.
 *
 * Why it exists: a host can only reach a viewer window by name if both sit in
 * the same browsing-context group, which in practice means the host opened it.
 * A worklist tab the radiologist opened by hand cannot find the viewer another
 * tab opened — `window.open('', name)` conjures a new blank window instead. A
 * BroadcastChannel has no such limit, but it is same-origin only; this page,
 * served from the viewer's origin and embedded hidden by the host, is the
 * bridge.
 *
 * What it guarantees, and nothing else:
 * - Every request it relays carries `origin`, taken from the browser's own
 *   MessageEvent — the viewer checks it against its allowlist, so embedding
 *   this page grants nothing the host's origin did not already have.
 * - It only accepts messages from the page that embeds it.
 * - It hands back only the answers to its own requests, plus READY
 *   announcements, so one host does not read another's results.
 *
 * The partitioning of storage means this only meets viewer windows whose top
 * level is the same site as the embedding page (`*.cui.date` with
 * `ohif.cui.date`); from anywhere else the channel is simply empty.
 */
(function () {
  'use strict';

  var CHANNEL = 'ohif-external-control';

  if (window.parent === window || typeof BroadcastChannel !== 'function') {
    return;
  }

  var bus = new BroadcastChannel(CHANNEL);
  var parentOrigin = null;
  var mine = {};

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) {
      return;
    }
    var data = event.data;
    if (!data || typeof data !== 'object' || data.channel !== CHANNEL) {
      return;
    }
    if (typeof data.action !== 'string') {
      return;
    }
    // The page that embeds us can only change by being replaced, which takes
    // this iframe with it, so the first origin is the only one.
    if (parentOrigin === null) {
      parentOrigin = event.origin;
    } else if (event.origin !== parentOrigin) {
      return;
    }
    // A handshake is answered with READY, which is passed on anyway; noting
    // its id would only grow the table, since the host repeats it until heard.
    if (typeof data.requestId === 'string' && data.action !== 'HANDSHAKE') {
      mine[data.requestId] = true;
    }
    var relayed = {};
    for (var key in data) {
      relayed[key] = data[key];
    }
    relayed.origin = event.origin;
    bus.postMessage(relayed);
  });

  bus.addEventListener('message', function (event) {
    var data = event.data;
    if (!parentOrigin || !data || typeof data !== 'object' || data.channel !== CHANNEL) {
      return;
    }
    if (data.type === 'READY') {
      window.parent.postMessage(data, parentOrigin);
      return;
    }
    if (data.type === 'RESULT' && mine[data.requestId]) {
      delete mine[data.requestId];
      window.parent.postMessage(data, parentOrigin);
    }
  });
})();
