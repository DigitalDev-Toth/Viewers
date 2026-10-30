/**
 * Lo que «Medir IA» calcula sin tocar el visor: la URL del pedido, los tres
 * puntos del ángulo de cada cadera y qué cadera del paciente es cuál. Vive
 * aparte para poder probarlo sin Cornerstone.
 */

export type Punto = [number, number];
export type Puntos = Record<'tcc_izq' | 'asm_izq' | 'tcc_der' | 'asm_der', Punto>;
export type Mitad = 'izq' | 'der';

type Instancia = { Rows?: number; Columns?: number; PhotometricInterpretation?: string };

/**
 * La URL de /ia/caderas para esta imagen, o null si no viene del WADO del
 * centro.
 *
 * El imageId del manifiesto de dicom-index es
 * `dicomweb:<wado_base>/wado?requestType=WADO&studyUID=…&seriesUID=…&objectUID=…&client=…`,
 * con <wado_base> = `<origen>/api` en producción y el proxy de desarrollo en
 * local. La medición vive al lado de /wado en los dos, así que no hace falta
 * configurar nada: el servidor del visor la autoriza con la misma compuerta
 * que la imagen.
 */
export function urlMedicion(
  imageId: string | undefined,
  instancia: Instancia | undefined
): string | null {
  const m = /^(?:dicomweb|wadouri):(.+)$/.exec(imageId ?? '');
  if (!m) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(m[1]);
  } catch {
    return null;
  }
  if (!url.pathname.endsWith('/wado')) {
    return null;
  }
  const filas = Number(instancia?.Rows);
  const columnas = Number(instancia?.Columns);
  if (!(filas > 0 && columnas > 0)) {
    return null;
  }
  const q = new URLSearchParams();
  for (const clave of ['client', 'studyUID', 'seriesUID', 'objectUID']) {
    const valor = url.searchParams.get(clave);
    if (!valor) {
      return null;
    }
    q.set(clave, valor);
  }
  q.set('filas', String(filas));
  q.set('columnas', String(columnas));
  const fotometria = instancia?.PhotometricInterpretation;
  if (typeof fotometria === 'string' && fotometria.trim()) {
    q.set('fotometria', fotometria.trim());
  }
  return `${url.origin}${url.pathname.replace(/\/wado$/, '/ia/caderas')}?${q}`;
}

/**
 * Los tres puntos de la herramienta Ángulo para cada cadera, en píxeles de la
 * imagen: [punto lateral sobre Hilgenreiner, cartílago trirradiado, techo].
 *
 * La herramienta Ángulo de Cornerstone mide el ángulo en el punto del medio,
 * así que con este orden lo que muestra es el índice acetabular. (Cobb no
 * sirve: reordena los segmentos por los extremos más cercanos y, con el vértice
 * compartido, mediría 180° menos el índice.) El primer punto prolonga
 * Hilgenreiner hacia afuera, un 25 % más que el techo, para que el ángulo se
 * vea abierto hacia lateral como se dibuja a mano.
 */
export function angulosCaderas(p: Puntos): Record<Mitad, [Punto, Punto, Punto]> {
  const hx = p.tcc_der[0] - p.tcc_izq[0];
  const hy = p.tcc_der[1] - p.tcc_izq[1];
  const n = Math.hypot(hx, hy);
  const u: Punto = [hx / n, hy / n]; // hacia la derecha de la imagen

  const uno = (tcc: Punto, asm: Punto, hacia: 1 | -1): [Punto, Punto, Punto] => {
    const largo = 1.25 * Math.hypot(asm[0] - tcc[0], asm[1] - tcc[1]);
    const lateral: Punto = [tcc[0] + hacia * largo * u[0], tcc[1] + hacia * largo * u[1]];
    return [lateral, tcc, asm];
  };

  return { izq: uno(p.tcc_izq, p.asm_izq, -1), der: uno(p.tcc_der, p.asm_der, 1) };
}

/**
 * Qué cadera del paciente queda en la mitad izquierda de la imagen.
 *
 * PatientOrientation (0020,0020) dice hacia dónde del paciente avanzan las
 * columnas y las filas. En una AP habitual es `L\F`: hacia la derecha de la
 * imagen está la izquierda del paciente, o sea que la mitad izquierda es su
 * cadera derecha. Si avanza hacia `R` (placa volteada), es al revés. Sin el
 * dato se supone la habitual.
 */
export function caderaDeLaIzquierda(orientacion: string | undefined): 'derecha' | 'izquierda' {
  const columnas = (orientacion ?? '').split('\\')[0].trim().toUpperCase();
  return columnas.startsWith('R') ? 'izquierda' : 'derecha';
}

export const PREFIJO = 'IA · cadera';

export function etiqueta(cadera: 'derecha' | 'izquierda'): string {
  return `${PREFIJO} ${cadera} (paciente)`;
}

/** El aviso para el radiólogo según lo que respondió el servidor. */
export function avisoDeError(
  status: number,
  cuerpo: { motivo?: string; error?: string } | null
): string {
  const motivo = cuerpo?.motivo ?? cuerpo?.error;
  if (status === 422) {
    return `La IA no reconoce una pelvis AP en esta imagen${motivo ? ` (${motivo})` : ''}.`;
  }
  if (status === 401 || status === 403) {
    return 'El enlace no autoriza medir esta imagen.';
  }
  return motivo ? `No se pudo medir: ${motivo}.` : `No se pudo medir (error ${status}).`;
}
