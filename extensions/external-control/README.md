# @ohif/extension-external-control

Drive a running OHIF window from another application, over `postMessage`.

## The problem

On a diagnostic workstation the radiologist keeps the viewer open on the second
and third monitors for the whole shift, and the worklist on the first pushes
studies into it. Reloading the viewer for each report is not a small cost: it
throws away measurements, the layout, the hanging protocol state, and every
decoded image in the cache.

OHIF already has all the machinery for this. Commands add studies, change the
layout and hang display sets; `MultiMonitorService` already runs commands in a
*different viewer window*. What was missing is a way for a page on a **different
origin** to reach those commands — there is no `postMessage` anywhere in the
repo, and `platform/docs/docs/deployment/iframe.md` has mentioned the idea since
v3 without an example.

This extension is that transport, and nothing more. Every action it accepts
becomes an ordinary `commandsManager.runAsync(...)` call.

```
host page  ──postMessage──▶  channel (origin allowlist)  ──▶  OHIF commands
```

## Enabling it

It ships inert. Until a deployment names the origins it trusts, no listener is
installed at all.

```js
window.config = {
  extensions: ['@ohif/extension-external-control'],
  externalControl: {
    allowedOrigins: ['https://ris.example.org'],
    // Off by default: this hands the host every command the viewer has.
    allowRunCommands: false,
  },
};
```

`allowedOrigins` entries are exact origins, or a single-label subdomain pattern
such as `https://*.ris.example.org` for a RIS that serves each site on its own
subdomain. The pattern fixes the scheme and port and matches exactly one label:
not the bare domain, not `a.b.ris.example.org`. A bare `'*'` — or anything
looser, like `https://*.org` — is refused, not honoured.

## Host side

`public/external-control/client.js` is a dependency-free script, served from the
viewer's own origin so the two cannot drift apart:

```html
<script src="https://viewer.example.org/external-control/client.js"></script>
<script>
  const viewer = OHIFExternalControl.connect({
    viewerOrigin: 'https://viewer.example.org',
    openUrl: 'https://viewer.example.org/open?token=...',
  });

  // Must start from a click: window.open outside a user gesture is blocked.
  openButton.onclick = () => viewer.open();

  studyRow.onclick = () =>
    viewer.addStudies([{ StudyInstanceUID: uid }], { focus: true });
</script>
```

`public/external-control/example.html` is a working page with every action
wired up.

### Why the client is not two lines of `postMessage`

Three things go wrong when it is, and none of them announce themselves:

- **The window is usually already open.** A worklist is a multi-page app, so
  every navigation loses the `window` reference while the viewer beside it keeps
  running. Re-opening it by URL silently destroys the session. The client
  reattaches by window name and only navigates once a handshake has proved that
  nothing is listening — `window.open('', name)` conjures a blank window when
  none exists, so getting a window back is not evidence of a viewer.
- **`postMessage` has no buffer.** Anything sent before the viewer's listener
  exists is simply gone. Calls made too early are queued and flushed on READY.
- **Answers have to be matched to questions.** Every request carries a
  `requestId` and resolves its own promise.

## Protocol

Host → viewer:

```json
{ "channel": "ohif-external-control", "version": 1,
  "requestId": "7", "action": "ADD_STUDIES",
  "payload": { "studies": [{ "StudyInstanceUID": "1.2.3" }] } }
```

Viewer → host:

```json
{ "channel": "ohif-external-control", "version": 1, "type": "RESULT",
  "requestId": "7", "ok": true, "result": { "added": ["1.2.3"] } }
```

| Action | Payload | Does |
|---|---|---|
| `HANDSHAKE` | — | answered with `READY` and the capability list |
| `ADD_STUDIES` | `{studies, focus?}` | loads studies into the session |
| `REMOVE_STUDIES` | `{studies}` | empties their viewports, purges their images |
| `FOCUS` | `{StudyInstanceUID}` or `{displaySetInstanceUID}` | hangs it and raises the window |
| `SET_LAYOUT` | `{numRows, numCols}` (1–4 each) | splits the grid; new viewports get series not yet shown |
| `GET_SESSION_STATE` | — | what the session currently holds |
| `RUN_COMMANDS` | `{commands}` | any command; only with `allowRunCommands` |

A study entry may carry a `url`, for data sources that need to be pointed at a
manifest before they can be queried (`dicomjson`). The URL still goes through
that data source's own origin policy.

Errors come back as `{ok: false, error: {code, message}}`. Only an error the
handler chose to raise has its message forwarded; anything unexpected becomes
`INTERNAL` and is logged in the viewer, because an exception can carry paths and
identifiers the host has no business reading.

## Known gaps

- `DicomMetadataStore` has no removal API, so `REMOVE_STUDIES` frees the display
  sets and the decoded pixels but leaves the naturalized metadata resident. It
  is small next to the images, and it means re-adding the study later skips the
  network.
- The window-alive check relies on `window.closed`, which COOP can make lie. The
  handshake timeout is the real backstop.
