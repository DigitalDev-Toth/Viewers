/**
 * The commands the external-control channel exposes.
 *
 * They are ordinary OHIF commands, so they are equally usable from a hotkey, a
 * toolbar button, or `MultiMonitorService.run()` — the channel is only one more
 * caller. Nothing in here knows that postMessage exists.
 */

import { DicomMetadataStore } from '@ohif/core';
import { ErrorCodes, ExternalControlError } from './protocol';
import purgeDisplaySetImages from './purgeDisplaySetImages';

/** A bound, not a taste: past 4 per side each viewport is too small to read. */
const MAX_GRID_SIDE = 4;

/** Accepts `['1.2.3']`, `[{StudyInstanceUID}]`, or a single one of either. */
function normalizeStudies(studies: unknown): Array<{ StudyInstanceUID: string; url?: string }> {
  const list = Array.isArray(studies) ? studies : [studies];
  return list
    .map(entry => {
      if (typeof entry === 'string') {
        return { StudyInstanceUID: entry };
      }
      const record = entry as Record<string, unknown> | null;
      const uid = record?.StudyInstanceUID ?? record?.studyInstanceUid;
      if (typeof uid !== 'string' || !uid) {
        return null;
      }
      return {
        StudyInstanceUID: uid,
        ...(typeof record?.url === 'string' ? { url: record.url } : {}),
      };
    })
    .filter(Boolean) as Array<{ StudyInstanceUID: string; url?: string }>;
}

/**
 * A manifest URL decides what the viewer fetches and shows, so it does not get
 * to be arbitrary just because the origin asking is allowed.
 *
 * Same-origin by default — which is the normal shape, the manifest being served
 * by whatever serves the viewer — and anything else has to be named. Note this
 * is stricter than the data source's own policy, which only enforces its
 * allowlist when `UserAuthenticationService` holds a token; a deployment
 * authenticating by cookie (as ours does) gets no check from it at all.
 */
export function assertManifestAllowed(url: string, allowedManifestOrigins: string[]) {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    throw new ExternalControlError(ErrorCodes.BAD_REQUEST, 'la URL del manifiesto no es válida');
  }
  if (parsed.origin === window.location.origin) {
    return url;
  }
  if (allowedManifestOrigins.includes(parsed.origin)) {
    return url;
  }
  throw new ExternalControlError(
    ErrorCodes.FORBIDDEN,
    `el manifiesto de ${parsed.origin} no está permitido`
  );
}

function getCommandsModule({ servicesManager, commandsManager, extensionManager }: withAppTypes) {
  const { displaySetService, hangingProtocolService, viewportGridService, customizationService } =
    servicesManager.services;

  const allowedManifestOrigins: string[] =
    extensionManager?.appConfig?.externalControl?.allowedManifestOrigins ?? [];

  function activeDataSource() {
    const [dataSource] = extensionManager.getActiveDataSource();
    if (!dataSource) {
      throw new ExternalControlError(ErrorCodes.INTERNAL, 'no hay data source activo');
    }
    return dataSource;
  }

  function displaySetsForStudy(StudyInstanceUID: string) {
    return displaySetService
      .getActiveDisplaySets()
      .filter(ds => ds.StudyInstanceUID === StudyInstanceUID);
  }

  /**
   * The grid state, or null while no mode route is mounted.
   *
   * `viewportGridService.getState()` throws outright before the provider has
   * handed it an implementation — it is not an optional call — so this is the
   * only honest way to ask "is there a session yet?".
   */
  function gridState() {
    try {
      return viewportGridService.getState();
    } catch {
      return null;
    }
  }

  /**
   * Wait until a mode is actually mounted.
   *
   * The channel starts listening at `preRegistration`, long before any route
   * exists — deliberately, so a host's first call is not lost. But the pieces
   * these commands need (the grid, and the mode's subscription that turns
   * arriving instances into display sets) only exist once a mode route mounts.
   * Without this wait, a host that pushes a study the moment the window opens
   * gets an unexplainable failure; with it, the call simply lands a second
   * later.
   */
  function whenSessionReady(timeoutMs = 30000): Promise<void> {
    if (gridState()) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const subscriptions = [
        viewportGridService.subscribe(viewportGridService.EVENTS.VIEWPORTS_READY, check),
        viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, check),
      ];
      const timer = setTimeout(() => {
        stop();
        reject(
          new ExternalControlError(
            ErrorCodes.INTERNAL,
            'el visor no tiene una sesión abierta todavía'
          )
        );
      }, timeoutMs);

      function stop() {
        clearTimeout(timer);
        subscriptions.forEach(subscription => subscription.unsubscribe());
      }
      function check() {
        if (gridState()) {
          stop();
          resolve();
        }
      }
    });
  }

  const actions = {
    /**
     * Make studies available in the running session, without a reload.
     *
     * @param studies UIDs, or `{StudyInstanceUID, url}` when the data source
     *   needs to be pointed at a manifest first (the `dicomjson` case).
     * @param focus hang the first of them once loaded.
     */
    addStudies: async ({ studies, focus = false }) => {
      const entries = normalizeStudies(studies);
      if (!entries.length) {
        throw new ExternalControlError(ErrorCodes.BAD_REQUEST, 'no se indicó ningún estudio');
      }
      // The display sets only get built by the mode's own subscription, so
      // loading metadata before a mode is mounted would leave the study in the
      // store and invisible everywhere else.
      await whenSessionReady();

      const dataSource = activeDataSource();
      const added: string[] = [];

      for (const { StudyInstanceUID, url } of entries) {
        // A manifest-driven data source has to be told where the study lives
        // before it can be queried for it. `initialize` accumulates, so this
        // adds the study without dropping the ones already loaded — and the
        // URL still goes through the data source's own origin policy.
        if (url && typeof dataSource.initialize === 'function') {
          await dataSource.initialize({ url: assertManifestAllowed(url, allowedManifestOrigins) });
        }

        if (!displaySetsForStudy(StudyInstanceUID).length) {
          // `filters: {}` rather than nothing: DicomJSONDataSource used to index
          // into `filters` without a default and throw a TypeError on
          // undefined. That is fixed at the source now
          // (extensions/default/src/DicomJSONDataSource/index.js), but passing
          // it keeps this extension working against an unpatched OHIF.
          await dataSource.retrieve.series.metadata({
            StudyInstanceUID,
            filters: {},
            sortCriteria: customizationService.getCustomization('sortingCriteria'),
          });
        }

        const study = DicomMetadataStore.getStudy(StudyInstanceUID);
        if (!study) {
          throw new ExternalControlError(
            ErrorCodes.NOT_FOUND,
            `el estudio ${StudyInstanceUID} no llegó a cargarse`
          );
        }
        // Puts it in front of the hanging protocol engine, so a later stage or
        // protocol change can match against it like any other study.
        hangingProtocolService.addStudy(study);
        added.push(StudyInstanceUID);
      }

      if (focus && added.length) {
        await actions.focusStudy({ StudyInstanceUID: added[0] });
      }

      // The count is worth reporting: a study can load its metadata and still
      // produce nothing displayable (every series unsupported), and the host
      // would otherwise read that as a success.
      return {
        added,
        displaySets: added.reduce((total, uid) => total + displaySetsForStudy(uid).length, 0),
      };
    },

    /**
     * Show a study (or one of its series) in a viewport and bring the window
     * forward. This is the "the radiologist is now reading this one" action.
     */
    focusStudy: async ({ StudyInstanceUID, displaySetInstanceUID, viewportId }) => {
      await whenSessionReady();
      const { activeViewportId, isHangingProtocolLayout } = viewportGridService.getState();
      const targetViewportId = viewportId ?? activeViewportId;
      if (!targetViewportId) {
        throw new ExternalControlError(ErrorCodes.INTERNAL, 'todavía no hay un viewport activo');
      }

      let targetDisplaySetUID = displaySetInstanceUID;
      if (!targetDisplaySetUID) {
        if (!StudyInstanceUID) {
          throw new ExternalControlError(
            ErrorCodes.BAD_REQUEST,
            'hace falta StudyInstanceUID o displaySetInstanceUID'
          );
        }
        const sortCriteria = customizationService.getCustomization('sortingCriteria');
        const candidates = displaySetsForStudy(StudyInstanceUID)
          .filter(ds => !ds.unsupported && !ds.excludeFromThumbnailBrowser)
          .sort(sortCriteria);
        if (!candidates.length) {
          throw new ExternalControlError(
            ErrorCodes.NOT_FOUND,
            `el estudio ${StudyInstanceUID} no tiene series mostrables cargadas`
          );
        }
        targetDisplaySetUID = candidates[0].displaySetInstanceUID;
      }

      const displaySet = displaySetService.getDisplaySetByUID(targetDisplaySetUID);
      if (!displaySet) {
        throw new ExternalControlError(
          ErrorCodes.NOT_FOUND,
          `no existe el display set ${targetDisplaySetUID}`
        );
      }

      hangingProtocolService.setActiveStudyUID(displaySet.StudyInstanceUID);

      const viewportsToUpdate = hangingProtocolService.getViewportsRequireUpdate(
        targetViewportId,
        targetDisplaySetUID,
        isHangingProtocolLayout
      );
      await commandsManager.runAsync('setDisplaySetsForViewports', { viewportsToUpdate });

      // Best effort: a window opened by the host can usually raise itself, and
      // on a diagnostic workstation that is the whole point of the action.
      try {
        window.focus();
      } catch {
        /* the browser said no; the study is displayed either way */
      }

      return {
        viewportId: targetViewportId,
        displaySetInstanceUID: targetDisplaySetUID,
        StudyInstanceUID: displaySet.StudyInstanceUID,
      };
    },

    /**
     * Split the grid into rows × columns — the "show me this study in two"
     * button of a worklist.
     *
     * It goes through OHIF's own `setViewportGridLayout`, the same command the
     * toolbar's layout selector runs, so viewports already on screen keep their
     * position and the new ones are filled with series not yet displayed.
     *
     * That command applies the layout on a timer and returns nothing, so the
     * answer waits for LAYOUT_CHANGED: otherwise the host would hear "ok" for a
     * layout the protocol's `onLayoutChange` callback is free to veto.
     */
    setViewerLayout: async ({ numRows, numCols }) => {
      const rows = Number(numRows);
      const cols = Number(numCols);
      const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_GRID_SIDE;
      if (!valid(rows) || !valid(cols)) {
        throw new ExternalControlError(
          ErrorCodes.BAD_REQUEST,
          `numRows y numCols tienen que ser enteros entre 1 y ${MAX_GRID_SIDE}`
        );
      }
      await whenSessionReady();

      const describe = () => {
        const { layout, viewports } = viewportGridService.getState();
        return { numRows: layout.numRows, numCols: layout.numCols, viewportCount: viewports.size };
      };
      const { layout } = viewportGridService.getState();
      if (layout.numRows === rows && layout.numCols === cols) {
        return describe();
      }

      await new Promise<void>((resolve, reject) => {
        const subscription = viewportGridService.subscribe(
          viewportGridService.EVENTS.LAYOUT_CHANGED,
          ({ numRows: changedRows, numCols: changedCols }) => {
            if (changedRows === rows && changedCols === cols) {
              clearTimeout(timer);
              subscription.unsubscribe();
              resolve();
            }
          }
        );
        const timer = setTimeout(() => {
          subscription.unsubscribe();
          reject(
            new ExternalControlError(
              ErrorCodes.INTERNAL,
              `el visor no aplicó el layout ${rows}x${cols}`
            )
          );
        }, 5000);
        commandsManager.runCommand('setViewportGridLayout', { numRows: rows, numCols: cols });
      });

      return describe();
    },

    /**
     * Drop studies the radiologist is done with, freeing their pixels.
     *
     * Viewports are emptied before the display sets go, otherwise the grid is
     * left holding UIDs that no longer resolve.
     */
    removeStudies: async ({ studies }) => {
      const entries = normalizeStudies(studies);
      if (!entries.length) {
        throw new ExternalControlError(ErrorCodes.BAD_REQUEST, 'no se indicó ningún estudio');
      }

      const removed: string[] = [];
      let purgedImages = 0;

      for (const { StudyInstanceUID } of entries) {
        const displaySets = displaySetsForStudy(StudyInstanceUID);
        if (!displaySets.length) {
          continue;
        }
        const uids = new Set(displaySets.map(ds => ds.displaySetInstanceUID));

        const viewportsToUpdate = [];
        gridState()?.viewports?.forEach((viewport, viewportId) => {
          const current = viewport.displaySetInstanceUIDs ?? [];
          const remaining = current.filter(uid => !uids.has(uid));
          if (remaining.length !== current.length) {
            viewportsToUpdate.push({ viewportId, displaySetInstanceUIDs: remaining });
          }
        });
        if (viewportsToUpdate.length) {
          viewportGridService.setDisplaySetsForViewports(viewportsToUpdate);
        }

        purgedImages += await purgeDisplaySetImages(displaySets);
        uids.forEach(uid => displaySetService.deleteDisplaySet(uid));

        // The hanging protocol keeps its own list of studies to match against;
        // leaving a removed one there would let a later stage hang it again.
        if (Array.isArray(hangingProtocolService.studies)) {
          hangingProtocolService.studies = hangingProtocolService.studies.filter(
            study => study.StudyInstanceUID !== StudyInstanceUID
          );
        }

        removed.push(StudyInstanceUID);
      }

      // Note: the naturalized metadata stays in DicomMetadataStore — it has no
      // removal API. It is small next to the pixels, and keeping it means
      // re-adding the study later skips the network entirely.
      return { removed, purgedImages };
    },

    /**
     * List what the session currently holds, so the host can stay in sync.
     *
     * Never waits and never fails: a host polls this to find out whether the
     * viewer is usable yet, so blocking or throwing would defeat the purpose.
     * `ready: false` means the window is up but no mode is mounted.
     */
    getSessionState: () => {
      const grid = gridState();
      const { activeViewportId, viewports } = grid ?? {};
      const studies = new Map<string, { StudyInstanceUID: string; displaySets: string[] }>();
      for (const displaySet of displaySetService.getActiveDisplaySets()) {
        const entry = studies.get(displaySet.StudyInstanceUID) ?? {
          StudyInstanceUID: displaySet.StudyInstanceUID,
          displaySets: [],
        };
        entry.displaySets.push(displaySet.displaySetInstanceUID);
        studies.set(displaySet.StudyInstanceUID, entry);
      }
      return {
        ready: Boolean(grid),
        activeViewportId: activeViewportId ?? null,
        activeStudyUID: hangingProtocolService.getState()?.activeStudyUID ?? null,
        viewportCount: viewports?.size ?? 0,
        studies: [...studies.values()],
      };
    },
  };

  return {
    definitions: {
      addStudies: { commandFn: actions.addStudies },
      removeStudies: { commandFn: actions.removeStudies },
      focusStudy: { commandFn: actions.focusStudy },
      setViewerLayout: { commandFn: actions.setViewerLayout },
      getSessionState: { commandFn: actions.getSessionState },
    },
    defaultContext: 'DEFAULT',
  };
}

export default getCommandsModule;
