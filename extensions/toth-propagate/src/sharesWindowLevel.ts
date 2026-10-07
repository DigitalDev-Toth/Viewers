/**
 * Cuándo dos series comparten ventaneo. Son las reglas de Horos
 * (`-[ViewerController propagateSettingsToViewer:]`), que a su vez son las de
 * OsiriX: no basta con que sean de la misma modalidad.
 */

/** Lo que hace falta saber de lo que muestra un viewport para decidir. */
export type SeriesTraits = {
  modality?: string;
  /** RGB / YBR: el ventaneo de una imagen en color no le sirve a una en gris. */
  isColor: boolean;
  /** Nombre del mapa de color aplicado; `undefined` es la escala de grises. */
  colormap?: string;
  /** PET con los valores ya convertidos a SUV. */
  isSuv: boolean;
};

/**
 * Horos no propaga nunca en estas dos. En CR cada placa trae su propia
 * exposición y su procesamiento, así que el ventaneo de una no dice nada de la
 * otra; en NM las cuentas dependen de la adquisición.
 */
const NEVER_PROPAGATE = new Set(['CR', 'NM']);

const normalizeColormap = (name?: string) => (name ?? 'grayscale').toLowerCase();

export function sharesWindowLevel(source: SeriesTraits, target: SeriesTraits): boolean {
  if (!source.modality || source.modality !== target.modality) {
    return false;
  }
  if (NEVER_PROPAGATE.has(source.modality)) {
    return false;
  }
  if (source.isColor !== target.isColor) {
    return false;
  }
  if (normalizeColormap(source.colormap) !== normalizeColormap(target.colormap)) {
    return false;
  }
  // Un PET en SUV y otro en cuentas crudas tienen escalas que no se parecen.
  if (source.modality === 'PT' && source.isSuv !== target.isSuv) {
    return false;
  }
  return true;
}

/**
 * Alt invierte el botón mientras se mantiene: con el botón apagado, ventanear
 * con Alt propaga; con el botón encendido, ventanear con Alt toca sólo esa
 * imagen.
 */
export function isPropagating(enabled: boolean, altHeld: boolean): boolean {
  return enabled !== altHeld;
}
