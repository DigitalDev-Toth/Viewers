/**
 * «Propagate settings» de Horos, sólo para el ventaneo: lo que se ventanea en
 * una serie se aplica en vivo a las demás que muestra la ventana, si comparten
 * ventaneo según `sharesWindowLevel`.
 *
 * Se maneja con el botón «Propagar» y con Alt, que lo invierte mientras se
 * mantiene. Para que Alt + arrastrar ventanee con cualquier herramienta
 * elegida, `WindowLevel` lleva además el atajo Alt + botón izquierdo, igual
 * que la cruz lleva Mayús + botón izquierdo.
 *
 * No se apoya en `syncGroupService` porque los grupos de sincronización se
 * arman de antemano, y acá cuáles series van juntas se decide en el momento de
 * ventanear —el colgado cambia, el radiólogo arrastra otra serie a un
 * viewport— y depende de reglas que el sincronizador de VOI no conoce.
 */

import { Enums as csEnums, metaData, utilities as csUtils } from '@cornerstonejs/core';
import { Enums as toolsEnums } from '@cornerstonejs/tools';

import { isPropagating, sharesWindowLevel, type SeriesTraits } from './sharesWindowLevel';

const STORAGE_KEY = 'toth.propagateWindowLevel';
const WINDOW_LEVEL = 'WindowLevel';

const PRIMARY = { mouseButton: toolsEnums.MouseBindings.Primary };
const ALT_PRIMARY = {
  mouseButton: toolsEnums.MouseBindings.Primary,
  modifierKey: toolsEnums.KeyboardBindings.Alt,
};

/** Donde el ventaneo no tiene sentido: render 3D, video, lámina, ECG. */
const PLANAR_TYPES = new Set<string>([
  csEnums.ViewportType.STACK,
  csEnums.ViewportType.ORTHOGRAPHIC,
  csEnums.ViewportType.PLANAR_NEXT,
]);

let enabled = readStored();
let altHeld = false;
/** Mientras se aplica a las demás, para no tomar sus propios VOI_MODIFIED. */
let applying = false;
/**
 * Hay un gesto del radiólogo en curso: el botón del mouse apretado (arrastrar
 * para ventanear, los controles deslizables del menú) o el mismo clic o tecla
 * que corre un preset. Sólo esos cambios de ventaneo se propagan.
 *
 * Así se deja afuera el ventaneo por defecto que trae cada serie al cargarse,
 * que no es una decisión del radiólogo y no tiene que pisar el de las demás: la
 * carga es asíncrona y nunca cae dentro de un gesto. También quedan afuera los
 * cortes que traen su propio ventaneo al recorrer la serie con la rueda.
 */
let pointerDown = false;
let inGesture = false;
/** Dónde se apretó el botón del mouse, para saber qué viewport se ventanea. */
let pointerTarget: Node | null = null;
let teardown: (() => void) | null = null;

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function isEnabled(): boolean {
  return enabled;
}

export function toggle(): boolean {
  enabled = !enabled;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Sin almacenamiento el botón igual funciona; sólo no se recuerda.
  }
  return enabled;
}

export function start({
  servicesManager,
  commandsManager,
}: {
  servicesManager: AppTypes.ServicesManager;
  commandsManager: AppTypes.CommandsManager;
}): void {
  stop();

  const { cornerstoneViewportService, viewportGridService, displaySetService, toolGroupService } =
    servicesManager.services;

  const traitsOf = (viewport): SeriesTraits | null => {
    if (!viewport || !PLANAR_TYPES.has(viewport.type)) {
      return null;
    }
    const uids = viewportGridService.getDisplaySetsUIDsForViewport(viewport.id) ?? [];
    // Una fusión (PET-CT) o una serie con superposiciones: no se sabe a cuál
    // de las capas le corresponde el ventaneo. Horos tampoco la propaga.
    if (uids.length !== 1) {
      return null;
    }
    const displaySet = displaySetService.getDisplaySetByUID(uids[0]);
    if (!displaySet) {
      return null;
    }
    const imageId = viewport.getCurrentImageId?.() ?? displaySet.imageIds?.[0];
    const photometric = imageId
      ? metaData.get('imagePixelModule', imageId)?.photometricInterpretation
      : undefined;
    let colormap: string | undefined;
    try {
      colormap = viewport.getProperties?.()?.colormap?.name;
    } catch {
      colormap = undefined;
    }
    return {
      modality: displaySet.Modality,
      isColor: typeof photometric === 'string' && !photometric.startsWith('MONOCHROME'),
      colormap,
      isSuv: imageId ? metaData.get('scalingModule', imageId)?.suvbw != null : false,
    };
  };

  const onVoiModified = (evt: Event) => {
    const { viewportId, range } = (evt as CustomEvent).detail ?? {};
    if (applying || !range || !isPropagating(enabled, altHeld)) {
      return;
    }
    if (!pointerDown && !inGesture) {
      return;
    }
    // El viewport que está bajo el puntero, o el activo para un preset. No
    // alcanza con el activo: OHIF lo cambia un instante después del primer
    // clic, y los primeros movimientos del arrastre se perderían.
    const underPointer = pointerDown && (evt.target as Node).contains?.(pointerTarget);
    if (!underPointer && viewportId !== viewportGridService.getActiveViewportId()) {
      return;
    }

    const renderingEngine = cornerstoneViewportService.getRenderingEngine();
    const source = traitsOf(renderingEngine?.getViewport(viewportId));
    if (!source) {
      return;
    }

    const { windowWidth, windowCenter } = csUtils.windowLevel.toWindowLevel(
      range.lower,
      range.upper
    );

    applying = true;
    try {
      for (const viewport of renderingEngine.getViewports()) {
        if (viewport.id === viewportId) {
          continue;
        }
        const target = traitsOf(viewport);
        if (!target || !sharesWindowLevel(source, target)) {
          continue;
        }
        // Por el comando y no con `setProperties`: el comando sabe aplicarlo
        // tanto en los viewports clásicos como en los `*_NEXT`.
        commandsManager.runCommand('setViewportWindowLevel', {
          viewportId: viewport.id,
          windowWidth,
          windowCenter,
        });
      }
    } finally {
      applying = false;
    }
  };

  // El estado de Alt se lee de cada evento y no sólo de keydown/keyup: si se
  // suelta Alt con el foco en otra ventana, el keyup nunca llega.
  const onPointer = (evt: PointerEvent) => {
    altHeld = evt.altKey;
    if (evt.type === 'pointerdown') {
      pointerDown = true;
      pointerTarget = evt.target as Node;
    } else if (evt.type !== 'pointermove') {
      pointerDown = false;
      pointerTarget = null;
    }
  };
  const onKey = (evt: KeyboardEvent) => {
    altHeld = evt.altKey;
  };
  // Un clic o una tecla dura lo que dura su propio despacho: los manejadores
  // corren todos antes que el `setTimeout`.
  const onGesture = () => {
    inGesture = true;
    setTimeout(() => (inGesture = false));
  };
  const onBlur = () => {
    altHeld = false;
    pointerDown = false;
    pointerTarget = null;
  };

  const ensureAltBinding = (toolGroupId: string) => {
    const toolGroup = toolGroupService.getToolGroup(toolGroupId);
    const options = toolGroup?.getToolOptions(WINDOW_LEVEL);
    if (!options) {
      return;
    }
    const bindings = options.bindings ?? [];
    const has = binding =>
      bindings.some(
        b => b.mouseButton === binding.mouseButton && b.modifierKey === binding.modifierKey
      );
    if (has(ALT_PRIMARY)) {
      return;
    }
    // `setToolActive` suma los atajos a los que ya tiene, pero decide si la
    // herramienta es la principal mirando sólo los que recibe: si ya lo era,
    // hay que volver a pasarle el botón izquierdo solo.
    const isPrimary = options.mode === toolsEnums.ToolModes.Active && has(PRIMARY);
    toolGroup.setToolActive(WINDOW_LEVEL, {
      bindings: isPrimary ? [PRIMARY, ALT_PRIMARY] : [ALT_PRIMARY],
    });
  };

  // [destino, evento, manejador, captura]. Los VOI_MODIFIED se disparan en el
  // elemento de cada viewport y no burbujean, pero sí pasan por la fase de
  // captura del documento.
  const listeners: Array<[EventTarget, string, (evt: Event) => void, boolean]> = [
    [document, csEnums.Events.VOI_MODIFIED, onVoiModified, true],
    [window, 'pointerdown', onPointer, true],
    [window, 'pointermove', onPointer, true],
    [window, 'pointerup', onPointer, true],
    // Arrastrar una miniatura al viewport es un drag nativo: no hay pointerup.
    [window, 'pointercancel', onPointer, true],
    [window, 'dragend', onBlur, true],
    [window, 'keydown', onKey, true],
    [window, 'keyup', onKey, true],
    [window, 'keydown', onGesture, true],
    [window, 'click', onGesture, true],
    [window, 'blur', onBlur, false],
  ];
  listeners.forEach(([target, type, fn, capture]) => target.addEventListener(type, fn, capture));

  const subscription = toolGroupService.subscribe(
    toolGroupService.EVENTS.VIEWPORT_ADDED,
    ({ toolGroupId }) => ensureAltBinding(toolGroupId)
  );
  toolGroupService.getToolGroupIds().forEach(ensureAltBinding);

  teardown = () => {
    listeners.forEach(([target, type, fn, capture]) =>
      target.removeEventListener(type, fn, capture)
    );
    subscription.unsubscribe();
    onBlur();
  };
}

export function stop(): void {
  teardown?.();
  teardown = null;
}
