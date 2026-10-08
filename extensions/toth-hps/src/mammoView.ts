/**
 * La proyección de una serie de mamografía: 'RCC', 'LCC', 'RMLO', 'LMLO', o
 * undefined si no es ninguna de esas (una ML, una pieza quirúrgica…).
 *
 * Primero lo que diga el DICOM —ImageLaterality, y para la proyección
 * ViewCodeSequence o ViewPosition—, y si no viene, la descripción de la
 * serie, donde los mamógrafos de los centros usan dos convenciones:
 * "R CC" / "L MLO" y "CC-D" / "MLO-I".
 */

/**
 * La proyección por código, en las dos codificaciones que circulan: SNOMED CT
 * y los códigos SRT antiguos, que es lo que manda la mayoría de los equipos
 * instalados (norteimagen, por ejemplo). Se mira sólo el CodeValue: los dos
 * esquemas no comparten valores. Magnificación o compresión focal no cambian
 * el código, van en ViewModifierCodeSequence.
 */
const VIEW_CODES = {
  '399162004': 'CC', // SCT cranio-caudal
  '399368009': 'MLO', // SCT medio-lateral oblique
  'R-10242': 'CC', // SRT cranio-caudal
  'R-10226': 'MLO', // SRT medio-lateral oblique
};

/** Los valores de ViewPosition (0018,5101) que son una de las dos. */
const VIEW_POSITIONS = { CC: 'CC', MLO: 'MLO' };

type InstanceLike = {
  ImageLaterality?: string;
  ViewPosition?: string;
  ViewCodeSequence?: Array<{ CodeValue?: string }> | { CodeValue?: string };
};

type SeriesLike = {
  SeriesDescription?: string;
  images?: InstanceLike[];
  instances?: InstanceLike[];
};

export default function mammoView(series: SeriesLike): string | undefined {
  const instance = series?.images?.[0] ?? series?.instances?.[0];
  const tokens = (series?.SeriesDescription ?? '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);

  // Una secuencia de un solo ítem puede llegar como objeto, no como lista.
  const viewCode = Array.isArray(instance?.ViewCodeSequence)
    ? instance.ViewCodeSequence[0]
    : instance?.ViewCodeSequence;

  const view =
    VIEW_CODES[viewCode?.CodeValue] ??
    VIEW_POSITIONS[(instance?.ViewPosition ?? '').trim().toUpperCase()] ??
    (tokens.includes('MLO') ? 'MLO' : tokens.includes('CC') ? 'CC' : undefined);

  const laterality = instance?.ImageLaterality;
  const side =
    laterality === 'R' || laterality === 'L'
      ? laterality
      : tokens.some(token => ['R', 'RIGHT', 'D', 'DER', 'DERECHA'].includes(token))
        ? 'R'
        : tokens.some(token => ['L', 'LEFT', 'I', 'IZQ', 'IZQUIERDA'].includes(token))
          ? 'L'
          : undefined;

  return view && side ? side + view : undefined;
}
