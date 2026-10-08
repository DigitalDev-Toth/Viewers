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
import { cancelStudyPrefetch, prefetchStudy, studyPrefetchProgress } from './prefetchStudyImages';

/** Series that are not images to read: reports, presentation states, key objects. */
const NON_IMAGE_MODALITIES = new Set(['SR', 'PR', 'KO']);

/**
 * The modality a study is "about": the one most of its series have, leaving
 * out the non-image ones. A host keys per-modality preferences on it because
 * its own idea of the modality may be coarser ("rx" for everything).
 */
export function mainModality(series: Array<{ Modality?: string }>): string | null {
  const counts = new Map<string, number>();
  for (const { Modality } of series) {
    if (Modality && !NON_IMAGE_MODALITIES.has(Modality)) {
      counts.set(Modality, (counts.get(Modality) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  counts.forEach((count, modality) => {
    if (best === null || count > counts.get(best)) {
      best = modality;
    }
  });
  return best;
}

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

/** The only place RELOAD_SESSION may send the viewer: its own `/open`. */
export function assertReloadUrl(url: unknown): string {
  let target: URL;
  try {
    target = new URL(String(url), window.location.href);
  } catch {
    throw new ExternalControlError(ErrorCodes.BAD_REQUEST, 'la URL no es válida');
  }
  if (target.origin !== window.location.origin || target.pathname !== '/open') {
    throw new ExternalControlError(
      ErrorCodes.FORBIDDEN,
      'sólo se puede recargar con el enlace /open de este visor'
    );
  }
  return target.href;
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

  /** getProtocolById throws on an unknown id rather than returning nothing. */
  function findProtocol(protocolId: string) {
    try {
      return hangingProtocolService.getProtocolById(protocolId);
    } catch {
      return undefined;
    }
  }

  /** Every image of a study, series in the order the panel shows them. */
  function imageIdsForStudy(StudyInstanceUID: string): string[] {
    const dataSource = activeDataSource();
    return displaySetsForStudy(StudyInstanceUID)
      .filter(ds => !ds.unsupported)
      .sort(customizationService.getCustomization('sortingCriteria'))
      .flatMap(ds => dataSource.getImageIdsForDisplaySet(ds) ?? []);
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
   * A mode has laid out its viewports. The grid itself exists at the app level
   * — on the bare root it answers with one empty viewport — so its presence
   * says nothing; an active viewport does.
   */
  function modeMounted() {
    return Boolean(gridState()?.activeViewportId);
  }

  /**
   * Open on the root, with no study: nothing will ever mount a mode there, so
   * waiting for one would only time out. A window the host opened without a
   * study URL — or with an empty one — looks like this.
   */
  function isEmptyViewer() {
    return !modeMounted() && /^\/?$/.test(window.location.pathname);
  }

  /** Resolves once the study has display sets, i.e. the mode has loaded it. */
  function whenStudyHasDisplaySets(StudyInstanceUID: string, timeoutMs = 60000): Promise<void> {
    if (displaySetsForStudy(StudyInstanceUID).length) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const subscription = displaySetService.subscribe(
        displaySetService.EVENTS.DISPLAY_SETS_ADDED,
        () => {
          if (displaySetsForStudy(StudyInstanceUID).length) {
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
            ErrorCodes.NOT_FOUND,
            `el estudio ${StudyInstanceUID} no produjo series mostrables`
          )
        );
      }, timeoutMs);
    });
  }

  /**
   * Bring an empty viewer into the mode with this study, the same way its URL
   * would have: the mode loads it, hangs it and builds the display sets. It
   * goes through OHIF's own navigation, so the page — and with it the
   * channel, the cache and the host's connection — is not reloaded.
   */
  async function enterModeWith({ StudyInstanceUID, url }: { StudyInstanceUID: string; url?: string }) {
    const query = new URLSearchParams();
    if (url) {
      query.set('url', assertManifestAllowed(url, allowedManifestOrigins));
    }
    query.set('StudyInstanceUIDs', StudyInstanceUID);
    commandsManager.runCommand('navigateHistory', {
      to: `/viewer?${query.toString()}`,
      options: { replace: true },
    });
    await whenSessionReady();
    await whenStudyHasDisplaySets(StudyInstanceUID);
  }

  /** Resolves once no viewport references any of `uids` any more. */
  function whenGridReleases(uids: Set<string>, timeoutMs = 3000): Promise<void> {
    const released = () => {
      let holding = false;
      gridState()?.viewports?.forEach(viewport => {
        if ((viewport.displaySetInstanceUIDs ?? []).some(uid => uids.has(uid))) {
          holding = true;
        }
      });
      return !holding;
    };
    if (released()) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const subscription = viewportGridService.subscribe(
        viewportGridService.EVENTS.GRID_STATE_CHANGED,
        () => {
          if (released()) {
            finish();
          }
        }
      );
      // Not an error if it never confirms: the removal still has to happen,
      // and the worst case is the prefetcher hiccup this wait exists to avoid.
      const timer = setTimeout(finish, timeoutMs);
      function finish() {
        clearTimeout(timer);
        subscription.unsubscribe();
        resolve();
      }
    });
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
    if (modeMounted()) {
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
        if (modeMounted()) {
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
     * @param prefetch also download their images in the background, so that
     *   switching to them later does not wait on the network.
     */
    addStudies: async ({ studies, focus = false, prefetch = false }) => {
      const entries = normalizeStudies(studies);
      if (!entries.length) {
        throw new ExternalControlError(ErrorCodes.BAD_REQUEST, 'no se indicó ningún estudio');
      }
      // The display sets only get built by the mode's own subscription, so
      // loading metadata before a mode is mounted would leave the study in the
      // store and invisible everywhere else. An empty viewer will never mount
      // one on its own: the first study is what takes it into the mode.
      if (isEmptyViewer()) {
        await enterModeWith(entries[0]);
      }
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
        ...(prefetch
          ? {
              prefetch: Object.fromEntries(
                added.map(uid => [uid, prefetchStudy(uid, imageIdsForStudy(uid))])
              ),
            }
          : {}),
      };
    },

    /**
     * Download, in the background, the images of studies already in the
     * session — for a host that added them without `prefetch` and decides
     * later. Progress is reported per study by GET_SESSION_STATE.
     */
    prefetchStudies: ({ studies }) => {
      const entries = normalizeStudies(studies);
      if (!entries.length) {
        throw new ExternalControlError(ErrorCodes.BAD_REQUEST, 'no se indicó ningún estudio');
      }
      const prefetch = {};
      const missing: string[] = [];
      for (const { StudyInstanceUID } of entries) {
        if (!displaySetsForStudy(StudyInstanceUID).length) {
          missing.push(StudyInstanceUID);
          continue;
        }
        prefetch[StudyInstanceUID] = prefetchStudy(
          StudyInstanceUID,
          imageIdsForStudy(StudyInstanceUID)
        );
      }
      if (!Object.keys(prefetch).length) {
        throw new ExternalControlError(
          ErrorCodes.NOT_FOUND,
          'ninguno de esos estudios está en la sesión: agrégalos primero'
        );
      }
      return { prefetch, ...(missing.length ? { missing } : {}) };
    },

    /**
     * Show a study (or one of its series) in a viewport and bring the window
     * forward. This is the "the radiologist is now reading this one" action.
     */
    focusStudy: async ({ StudyInstanceUID, displaySetInstanceUID, viewportId }) => {
      if (isEmptyViewer()) {
        throw new ExternalControlError(
          ErrorCodes.NOT_FOUND,
          'el visor está vacío: agrega un estudio primero'
        );
      }
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
      if (isEmptyViewer()) {
        throw new ExternalControlError(
          ErrorCodes.NOT_FOUND,
          'el visor está vacío: agrega un estudio primero'
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
     * Which hanging protocols apply to a study, with their stages — for a host
     * that lets each doctor pick a preferred layout per modality.
     *
     * Every registered protocol is evaluated, not only the mode's active ones:
     * the point is to offer what fits this study, and the mode typically
     * activates just a default. Matching uses the protocol engine's own rules
     * against this study and its display sets alone.
     */
    getHangingProtocols: async ({ StudyInstanceUID }) => {
      if (typeof StudyInstanceUID !== 'string' || !StudyInstanceUID) {
        throw new ExternalControlError(ErrorCodes.BAD_REQUEST, 'falta StudyInstanceUID');
      }
      await whenSessionReady();
      const study = DicomMetadataStore.getStudy(StudyInstanceUID);
      const displaySets = displaySetsForStudy(StudyInstanceUID);
      if (!study || !displaySets.length) {
        throw new ExternalControlError(
          ErrorCodes.NOT_FOUND,
          `el estudio ${StudyInstanceUID} no está en la sesión`
        );
      }

      const series = (study.series ?? []).map(serie => ({
        Modality: serie.Modality ?? serie.instances?.[0]?.Modality,
      }));
      const matchStudy = {
        ...study,
        ModalitiesInStudy:
          study.ModalitiesInStudy?.length > 0
            ? study.ModalitiesInStudy
            : [...new Set(series.map(serie => serie.Modality).filter(Boolean))],
      };

      const protocols = [];
      for (const protocolId of hangingProtocolService.protocols.keys()) {
        const protocol = findProtocol(protocolId);
        const rules = protocol?.protocolMatchingRules;
        if (!rules?.length) {
          continue;
        }
        const { score } = hangingProtocolService.runMatchingRules(matchStudy, rules, {
          studies: [matchStudy],
          displaySets,
        });
        if (score > 0) {
          protocols.push({
            id: protocol.id,
            name: protocol.name ?? protocol.id,
            score,
            // A stage without id cannot be asked for by SET_HANGING_PROTOCOL
            // — OHIF looks stages up by id only — so it comes back as null.
            stages: (protocol.stages ?? []).map(stage => ({
              id: stage.id ?? null,
              name: stage.name ?? stage.id ?? null,
            })),
          });
        }
      }
      protocols.sort((a, b) => b.score - a.score);

      return {
        modality: mainModality(series),
        protocols: protocols.map(({ score, ...protocol }) => protocol),
      };
    },

    /**
     * Hang a study with a given protocol and stage, or — without protocolId —
     * go back to the one OHIF picks on its own.
     */
    setHangingProtocol: async ({ StudyInstanceUID, protocolId, stageId }) => {
      if (typeof StudyInstanceUID !== 'string' || !StudyInstanceUID) {
        throw new ExternalControlError(ErrorCodes.BAD_REQUEST, 'falta StudyInstanceUID');
      }
      if (protocolId !== undefined && protocolId !== null && typeof protocolId !== 'string') {
        throw new ExternalControlError(ErrorCodes.BAD_REQUEST, 'protocolId tiene que ser texto');
      }
      if (stageId !== undefined && stageId !== null && typeof stageId !== 'string') {
        throw new ExternalControlError(ErrorCodes.BAD_REQUEST, 'stageId tiene que ser texto');
      }
      if (stageId && !protocolId) {
        throw new ExternalControlError(
          ErrorCodes.BAD_REQUEST,
          'stageId sin protocolId: no se sabe de qué protocolo es la etapa'
        );
      }
      await whenSessionReady();
      const displaySets = displaySetsForStudy(StudyInstanceUID);
      const study = DicomMetadataStore.getStudy(StudyInstanceUID);
      if (!study || !displaySets.length) {
        throw new ExternalControlError(
          ErrorCodes.NOT_FOUND,
          `el estudio ${StudyInstanceUID} no está en la sesión`
        );
      }

      if (!protocolId) {
        // What OHIF would have chosen for this study on its own.
        hangingProtocolService.run({
          activeStudy: study,
          displaySets: displaySetService.getActiveDisplaySets(),
        });
      } else {
        const protocol = findProtocol(protocolId);
        if (!protocol) {
          throw new ExternalControlError(ErrorCodes.NOT_FOUND, `no existe el protocolo ${protocolId}`);
        }
        if (stageId && !(protocol.stages ?? []).some(stage => stage.id === stageId)) {
          throw new ExternalControlError(
            ErrorCodes.NOT_FOUND,
            `el protocolo ${protocolId} no tiene la etapa ${stageId}`
          );
        }
        // A fresh run on this study, so the protocol's selectors pick among
        // its series — and not whatever the previous one left hung.
        hangingProtocolService.run(
          { activeStudy: study, displaySets: displaySetService.getActiveDisplaySets() },
          protocol.id,
          stageId ? { stageId } : {}
        );
      }

      const { protocolId: applied, stageIndex, activeStudyUID } = hangingProtocolService.getState();
      const appliedProtocol = findProtocol(applied);
      const appliedStageId = appliedProtocol?.stages?.[stageIndex]?.id ?? null;
      // The service swallows its own failures — a stage whose required series
      // the study lacks is "disabled" and silently not applied — so the only
      // honest answer comes from reading back what got hung.
      const requestedId = protocolId && findProtocol(protocolId)?.id;
      if (requestedId && (applied !== requestedId || (stageId && appliedStageId !== stageId))) {
        throw new ExternalControlError(
          ErrorCodes.NOT_FOUND,
          stageId
            ? `la etapa ${stageId} de ${protocolId} no aplica a este estudio`
            : `el protocolo ${protocolId} no aplica a este estudio`
        );
      }
      return {
        StudyInstanceUID: activeStudyUID,
        protocolId: applied,
        stageId: appliedStageId,
        stageIndex,
      };
    },

    /**
     * Reload this window through the viewer's own `/open?token=…` link.
     *
     * A host that found the viewer over the bus has no window handle, so when
     * the running session lacks the credentials it needs — a window opened
     * with a one-study link, asked to load another — this is its only way to
     * hand over new ones. Only that one path on this same origin is accepted:
     * anything else would let an allowed host send the viewer anywhere.
     */
    reloadViewerSession: ({ url }) => {
      const target = assertReloadUrl(url);
      // After the answer is on its way: navigating first would drop it.
      setTimeout(() => window.location.assign(target), 50);
      return { reloading: true };
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
        // Before anything else: what is still queued for it would only fill
        // the cache with a study that is on its way out.
        cancelStudyPrefetch(StudyInstanceUID);
        const displaySets = displaySetsForStudy(StudyInstanceUID);
        if (!displaySets.length) {
          continue;
        }
        const uids = new Set(displaySets.map(ds => ds.displaySetInstanceUID));

        // A viewport left showing this study gets another study's series
        // rather than going black: the radiologist just finished one report,
        // and the next study already loaded is what they are moving on to.
        const replacements = displaySetService
          .getActiveDisplaySets()
          .filter(
            ds =>
              !uids.has(ds.displaySetInstanceUID) &&
              !ds.unsupported &&
              !ds.excludeFromThumbnailBrowser
          )
          .sort(customizationService.getCustomization('sortingCriteria'));
        const onScreen = new Set<string>();
        gridState()?.viewports?.forEach(viewport =>
          (viewport.displaySetInstanceUIDs ?? []).forEach(uid => onScreen.add(uid))
        );
        const nextReplacement = () => {
          const pick =
            replacements.find(ds => !onScreen.has(ds.displaySetInstanceUID)) ?? replacements[0];
          if (pick) {
            onScreen.add(pick.displaySetInstanceUID);
          }
          return pick;
        };

        const viewportsToUpdate = [];
        gridState()?.viewports?.forEach((viewport, viewportId) => {
          const current = viewport.displaySetInstanceUIDs ?? [];
          const remaining = current.filter(uid => !uids.has(uid));
          if (remaining.length === current.length) {
            return;
          }
          const replacement = remaining.length ? null : nextReplacement();
          viewportsToUpdate.push({
            viewportId,
            displaySetInstanceUIDs: replacement ? [replacement.displaySetInstanceUID] : remaining,
          });
        });

        if (hangingProtocolService.getState()?.activeStudyUID === StudyInstanceUID) {
          const other = replacements[0]?.StudyInstanceUID;
          if (other) {
            hangingProtocolService.setActiveStudyUID(other);
          }
        }

        if (viewportsToUpdate.length) {
          viewportGridService.setDisplaySetsForViewports(viewportsToUpdate);
          // The grid applies that a beat later. Deleting the display sets
          // before it does leaves a viewport pointing at UIDs that no longer
          // exist, and the study prefetcher — which follows the active
          // viewport — throws reading the loading state of one of them.
          await whenGridReleases(uids);
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
          ...(studyPrefetchProgress(displaySet.StudyInstanceUID)
            ? { prefetch: studyPrefetchProgress(displaySet.StudyInstanceUID) }
            : {}),
        };
        entry.displaySets.push(displaySet.displaySetInstanceUID);
        studies.set(displaySet.StudyInstanceUID, entry);
      }
      return {
        ready: modeMounted(),
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
      prefetchStudies: { commandFn: actions.prefetchStudies },
      removeStudies: { commandFn: actions.removeStudies },
      focusStudy: { commandFn: actions.focusStudy },
      setViewerLayout: { commandFn: actions.setViewerLayout },
      getHangingProtocols: { commandFn: actions.getHangingProtocols },
      setHangingProtocol: { commandFn: actions.setHangingProtocol },
      reloadViewerSession: { commandFn: actions.reloadViewerSession },
      getSessionState: { commandFn: actions.getSessionState },
    },
    defaultContext: 'DEFAULT',
  };
}

export default getCommandsModule;
