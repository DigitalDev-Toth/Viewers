/**
 * Drive a running OHIF window from another application, over postMessage.
 *
 * The use case is a diagnostic workstation: the radiologist keeps the viewer
 * open on the second and third monitors all shift, and the worklist on the
 * first pushes studies into it — add this one, drop the one just reported,
 * bring that one to the front — without ever reloading the viewer and losing
 * its measurements, layout and warm cache.
 *
 * OHIF already has every piece of that except the transport. Commands do the
 * work; `MultiMonitorService` already runs commands in another viewer window.
 * What was missing is a way for a *different origin* to reach them, which is
 * all this extension adds:
 *
 *   host page  ──postMessage──▶  channel (origin allowlist)  ──▶  commands
 *
 * It is inert until a deployment names the origins it trusts, so shipping it
 * enabled by default changes nothing for anyone who has not configured it.
 *
 *   window.config = {
 *     externalControl: { allowedOrigins: ['https://ris.example.org'] },
 *   };
 *
 * See `public/external-control/example.html` for the host side.
 */

import ExternalControlChannel from './ExternalControlChannel';
import getCommandsModule from './getCommandsModule';
import { Actions, ErrorCodes, ExternalControlError } from './protocol';
import { id } from './id.js';

/** Which command each action runs. One line per verb, on purpose. */
const ACTION_COMMANDS = {
  [Actions.ADD_STUDIES]: 'addStudies',
  [Actions.REMOVE_STUDIES]: 'removeStudies',
  [Actions.PREFETCH_STUDIES]: 'prefetchStudies',
  [Actions.FOCUS]: 'focusStudy',
  [Actions.SET_LAYOUT]: 'setViewerLayout',
  [Actions.GET_HANGING_PROTOCOLS]: 'getHangingProtocols',
  [Actions.SET_HANGING_PROTOCOL]: 'setHangingProtocol',
  [Actions.RELOAD_SESSION]: 'reloadViewerSession',
  [Actions.GET_SESSION_STATE]: 'getSessionState',
};

export function buildHandlers({ commandsManager, allowRunCommands = false }) {
  const runOne = (commandName: string) => async (payload: Record<string, unknown>) => {
    if (!commandsManager.getCommand(commandName)) {
      throw new ExternalControlError(
        ErrorCodes.INTERNAL,
        `el comando ${commandName} no está registrado en este visor`
      );
    }
    return commandsManager.runAsync(commandName, payload);
  };

  const handlers: Record<string, (payload: Record<string, unknown>) => Promise<unknown>> = {};
  for (const [action, commandName] of Object.entries(ACTION_COMMANDS)) {
    handlers[action] = runOne(commandName);
  }

  if (allowRunCommands) {
    // Deliberately off by default. An allowed origin can already add and remove
    // studies; this hands it every command the viewer has, which is a much
    // larger surface and should be an explicit decision, not a side effect of
    // configuring the extension.
    handlers[Actions.RUN_COMMANDS] = async payload => {
      const { commands } = payload as { commands?: unknown };
      if (!commands) {
        throw new ExternalControlError(ErrorCodes.BAD_REQUEST, 'falta `commands`');
      }
      return commandsManager.runAsync(commands as never);
    };
  }

  return handlers;
}

let channel: ExternalControlChannel | undefined;

/** Undoes what onModeEnter wired for the screens, if anything. */
let stopScreens: (() => void) | undefined;

/**
 * A grid change settles in several events — a layout, then each viewport —
 * and only the last one says what is on screen. Short enough that the other
 * screens change with this one, long enough to pass each change on once.
 */
const SCREENS_SETTLE_MS = 200;

/**
 * Keep the screens of a workstation on the same study.
 *
 * The lead — the window the host opened — passes on the study its active
 * viewport shows whenever the grid changes; every other window catches up
 * with the lead when it opens. See `syncScreens` and `followLeadScreen`.
 */
function startScreens({ servicesManager, commandsManager }) {
  const { viewportGridService, multiMonitorService } = servicesManager.services;
  if (!multiMonitorService?.isMultimonitor || !(multiMonitorService.numberOfScreens > 1)) {
    return undefined;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const sync = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        commandsManager.runCommand('syncScreens');
      } catch (error) {
        console.warn('[external-control] no se pudo sincronizar las pantallas:', error);
      }
    }, SCREENS_SETTLE_MS);
  };
  const subscriptions = [
    viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, sync),
    viewportGridService.subscribe(viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED, sync),
  ];

  // Not awaited: a window that cannot reach its lead is still a viewer.
  Promise.resolve(commandsManager.runAsync('followLeadScreen')).catch(error => {
    console.warn('[external-control] esta pantalla no pudo seguir a la principal:', error);
  });

  return () => {
    clearTimeout(timer);
    subscriptions.forEach(subscription => subscription.unsubscribe());
  };
}

const externalControlExtension = {
  id,

  preRegistration({ commandsManager, appConfig, configuration = {} }) {
    // Two sources because the two ways of declaring an extension differ: an
    // entry in `appConfig.extensions` given as a bare package name carries no
    // configuration object, which is exactly how a static app-config lists it.
    const settings = { ...(appConfig?.externalControl ?? {}), ...configuration };

    channel?.stop();
    channel = new ExternalControlChannel({
      allowedOrigins: settings.allowedOrigins,
      handlers: buildHandlers({
        commandsManager,
        allowRunCommands: Boolean(settings.allowRunCommands),
      }),
    });
    channel.start();

    if (channel.isEnabled) {
      console.log('[external-control] escuchando a:', settings.allowedOrigins.join(', '));
    }
  },

  onModeEnter({ servicesManager, commandsManager }) {
    stopScreens?.();
    stopScreens = startScreens({ servicesManager, commandsManager });
  },

  onModeExit() {
    stopScreens?.();
    stopScreens = undefined;
  },

  getCommandsModule,
};

export default externalControlExtension;
export { ExternalControlChannel };
export * from './protocol';
