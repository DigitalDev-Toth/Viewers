/**
 * The pure parts of keeping several viewer windows on the same study.
 *
 * On a multi-monitor workstation each screen is its own viewer window, with
 * its own session: a study pushed into one is unknown to the others. The host
 * talks to one window — the lead — and the lead passes on what it is showing.
 * Everything here is a decision with no services behind it, so it can be
 * tested on its own; the wiring is in getCommandsModule and index.
 */

export type WindowLike = { closed?: boolean } & Record<string, unknown>;

/**
 * The lead screen is the one the host drives: the window the worklist opened.
 * `MultiMonitorService` numbers it 0 when the deployment makes it a screen of
 * its own, and -1 when it is the bare source window that only launches the
 * others.
 */
export function isLeadScreen(screenNumber: number | undefined | null): boolean {
  return screenNumber === undefined || screenNumber === null || screenNumber <= 0;
}

/** The other viewer windows still open, by screen number. */
export function otherScreens(
  launchWindows: Array<WindowLike | undefined> | undefined,
  self: WindowLike
): Array<{ screenNumber: number; window: WindowLike }> {
  const result = [];
  (launchWindows ?? []).forEach((candidate, screenNumber) => {
    if (!candidate || candidate === self || candidate.closed) {
      return;
    }
    result.push({ screenNumber, window: candidate });
  });
  return result;
}

/**
 * The hanging protocol a window opened with, from its own URL — the one the
 * mode applied on entering, so a study pushed later hangs the same way the
 * first one did. Case-insensitive like the mode's own reading of the query.
 */
export function windowProtocol(search: string): { protocolId?: string; stageId?: string } {
  const query = new URLSearchParams(search);
  const read = (name: string) => {
    for (const [key, value] of query.entries()) {
      if (key.toLowerCase() === name.toLowerCase() && value) {
        return value;
      }
    }
    return undefined;
  };
  const protocolId = read('hangingProtocolId');
  if (!protocolId) {
    return {};
  }
  const stageId = read('stageId');
  return stageId ? { protocolId, stageId } : { protocolId };
}

/**
 * The study a window is "on": the one in its active viewport, or — when that
 * viewport is empty — the study last brought on screen. The same rule the
 * patient header uses, so what the other screens follow is what the header
 * of the lead says.
 */
export function shownStudy({
  activeViewportId,
  viewports,
  displaySetStudy,
  activeStudyUID,
}: {
  activeViewportId?: string;
  viewports?: Map<string, { displaySetInstanceUIDs?: string[] }>;
  displaySetStudy: (displaySetInstanceUID: string) => string | undefined;
  activeStudyUID?: string | null;
}): string | null {
  const uid = viewports?.get(activeViewportId)?.displaySetInstanceUIDs?.[0];
  const fromViewport = uid ? displaySetStudy(uid) : undefined;
  return fromViewport ?? activeStudyUID ?? null;
}
