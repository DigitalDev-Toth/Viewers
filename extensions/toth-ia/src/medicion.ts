/**
 * Lo que «Medir IA» calcula sin tocar el visor: la URL del pedido, las dos
 * líneas de Cobb de cada cadera (y su vuelta a los tres puntos que se guardan)
 * y qué cadera del paciente es cuál. Vive aparte para poder probarlo sin
 * Cornerstone.
 */

export type Punto = [number, number];
export type Puntos = Record<'tcc_izq' | 'asm_izq' | 'tcc_der' | 'asm_der', Punto>;
export type Mitad = 'izq' | 'der';
export type Tres = [Punto, Punto, Punto];
export type Cuatro = [Punto, Punto, Punto, Punto];

type Instancia = {
  Rows?: number;
  Columns?: number;
  PhotometricInterpretation?: string;
  PixelSpacing?: number[] | string;
};
export type Ruta = 'caderas' | 'pierna';

/** El tamaño del píxel (mm, filas) del DICOM, venga como lista o como texto `a\b`. */
export function mmPorPixel(instancia: Instancia | undefined): number | null {
  const valor = instancia?.PixelSpacing;
  const primero = Array.isArray(valor) ? valor[0] : String(valor ?? '').split('\\')[0];
  const mm = Number(primero);
  return Number.isFinite(mm) && mm > 0.01 && mm <= 2 ? mm : null;
}

/**
 * La URL de /ia/caderas (o /ia/pierna) para esta imagen, o null si no viene
 * del WADO del centro. La de pierna lleva además el tamaño del píxel (`mm`):
 * el modelo recorta cada articulación en milímetros.
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
  instancia: Instancia | undefined,
  ruta: Ruta = 'caderas'
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
  const mm = mmPorPixel(instancia);
  if (ruta === 'pierna' && mm) {
    q.set('mm', String(mm));
  }
  return `${url.origin}${url.pathname.replace(/\/wado$/, `/ia/${ruta}`)}?${q}`;
}

/**
 * Los tres puntos del índice acetabular de cada cadera, en píxeles de la
 * imagen: [punto lateral sobre Hilgenreiner, cartílago trirradiado, techo].
 * El índice es el ángulo en el del medio. Es la forma en que se guardan las
 * correcciones (y la de la herramienta Ángulo, que se usó hasta noviembre de
 * 2026); lo que se dibuja es `cobbCaderas`.
 *
 * El primer punto prolonga Hilgenreiner hacia afuera, un 25 % más que el
 * techo, para que el ángulo se vea abierto hacia lateral como se dibuja a mano.
 */
export function angulosCaderas(p: Puntos): Record<Mitad, Tres> {
  const hx = p.tcc_der[0] - p.tcc_izq[0];
  const hy = p.tcc_der[1] - p.tcc_izq[1];
  const n = Math.hypot(hx, hy);
  const u: Punto = [hx / n, hy / n]; // hacia la derecha de la imagen

  const uno = (tcc: Punto, asm: Punto, hacia: 1 | -1): Tres => {
    const largo = 1.25 * Math.hypot(asm[0] - tcc[0], asm[1] - tcc[1]);
    const lateral: Punto = [tcc[0] + hacia * largo * u[0], tcc[1] + hacia * largo * u[1]];
    return [lateral, tcc, asm];
  };

  return { izq: uno(p.tcc_izq, p.asm_izq, -1), der: uno(p.tcc_der, p.asm_der, 1) };
}

/** Cuánto se prolonga Hilgenreiner hacia afuera de cada cartílago, en largos de su techo. */
const PROLONGACION = 2;

/**
 * Las dos líneas de la herramienta Cobb de cada cadera, en píxeles de la
 * imagen: [Hilgenreiner de la mitad izquierda, Hilgenreiner de la derecha,
 * cartílago trirradiado, techo]. Hilgenreiner es la misma en las dos caderas:
 * pasa por los dos cartílagos y se prolonga hacia afuera de cada uno; cada
 * Cobb lleva su copia y `hilgenreiner.ts` las mueve juntas. El techo va del
 * cartílago al borde acetabular, así que no comparte vértice con
 * Hilgenreiner: el cartílago queda sobre ella, entre sus extremos.
 *
 * Cobb no mide en un vértice: junta las líneas por su par de extremos más
 * cercanos y mide el ángulo entre ellas, cada una orientada hacia su extremo
 * de ese par (`tresDesdeCobb`). Con la Hilgenreiner justo de un cartílago al
 * otro, el par es el cartílago de las dos líneas, pero Hilgenreiner llega a él
 * desde medial (apunta hacia afuera) y el techo desde lateral (apunta hacia
 * adentro): mostraría 180° menos el índice. Prolongada, el par es el extremo
 * de Hilgenreiner del lado de esa cadera con el borde del techo: las dos
 * apuntan hacia afuera y Cobb muestra el índice exacto. Pasaría a 180° menos
 * el índice si ese extremo quedara más cerca del cartílago que del borde, o
 * sea, con una prolongación más corta que techo / (2 · cos índice): con dos
 * techos, un índice de más de 75° (el servicio no dibuja más de 60°) o que el
 * radiólogo la acorte a menos de medio techo (a menos de un techo, con 60°).
 */
export function cobbCaderas(p: Puntos): Record<Mitad, Cuatro> {
  const hx = p.tcc_der[0] - p.tcc_izq[0];
  const hy = p.tcc_der[1] - p.tcc_izq[1];
  const n = Math.hypot(hx, hy);
  const u: Punto = [hx / n, hy / n]; // hacia la derecha de la imagen

  const extremo = (tcc: Punto, asm: Punto, hacia: 1 | -1): Punto => {
    const largo = PROLONGACION * Math.hypot(asm[0] - tcc[0], asm[1] - tcc[1]);
    return [tcc[0] + hacia * largo * u[0], tcc[1] + hacia * largo * u[1]];
  };
  const izq = extremo(p.tcc_izq, p.asm_izq, -1);
  const der = extremo(p.tcc_der, p.asm_der, 1);

  return {
    izq: [[...izq], [...der], p.tcc_izq, p.asm_izq],
    der: [[...izq], [...der], p.tcc_der, p.asm_der],
  };
}

/**
 * Dónde va el texto de cada ángulo: junto a su cartílago, sobre Hilgenreiner
 * y hacia la derecha de la imagen, como lo dibujan a mano. Sin esto Cobb lo
 * pone en su punto de más a la derecha, que con la línea compartida es el
 * mismo extremo de Hilgenreiner para las dos caderas. Es la esquina superior
 * izquierda del recuadro.
 */
export function textosCaderas(p: Puntos): Record<Mitad, Punto> {
  const hx = p.tcc_der[0] - p.tcc_izq[0];
  const hy = p.tcc_der[1] - p.tcc_izq[1];
  const n = Math.hypot(hx, hy);
  const u: Punto = [hx / n, hy / n];
  const abajo: Punto = [-u[1], u[0]];

  const uno = (tcc: Punto, asm: Punto): Punto => {
    const r = Math.hypot(asm[0] - tcc[0], asm[1] - tcc[1]);
    return [
      tcc[0] + 0.15 * r * u[0] + 0.1 * r * abajo[0],
      tcc[1] + 0.15 * r * u[1] + 0.1 * r * abajo[1],
    ];
  };

  return { izq: uno(p.tcc_izq, p.asm_izq), der: uno(p.tcc_der, p.asm_der) };
}

/**
 * La vuelta de las dos líneas de Cobb (`cobbCaderas`, quizá movidas por el
 * radiólogo) a los tres puntos que se guardan, sin perder el ángulo que
 * mostraba Cobb: el cartílago y el techo son los extremos del techo, y el
 * punto lateral queda a `largo` del cartílago en la dirección de
 * Hilgenreiner que da ese ángulo. Lo único que no pasa es dónde quedó
 * Hilgenreiner si se la corrió en paralelo, que no cambia el índice.
 *
 * Replica `_calculateCachedStats` de CobbAngleTool (@cornerstonejs/tools
 * 5.6.12): recorre los pares de extremos en el mismo orden (ante un empate
 * gana el primero) y orienta cada línea hacia su extremo del par más cercano.
 */
export function tresDesdeCobb(p: Cuatro, largo: number): Tres {
  let cerca1 = 0;
  let cerca2 = 2;
  let minimo = Infinity;
  for (const i of [0, 1]) {
    for (const j of [2, 3]) {
      const d = Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]);
      if (d < minimo) {
        [minimo, cerca1, cerca2] = [d, i, j];
      }
    }
  }
  const lejos1 = p[1 - cerca1];
  const v = [p[cerca1][0] - lejos1[0], p[cerca1][1] - lejos1[1]];
  // Cobb mide entre v y el techo orientado hacia su extremo cercano; desde el
  // cartílago, mirando al techo, eso es v si el cercano es el techo y -v si es
  // el cartílago.
  const k = ((cerca2 === 3 ? 1 : -1) * largo) / Math.hypot(v[0], v[1]);
  const [, , tcc, asm] = p;
  return [[tcc[0] + k * v[0], tcc[1] + k * v[1]], tcc, asm];
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

/**
 * Dónde se guarda la corrección de un ángulo de la IA: al lado de la medición,
 * con la misma query, así que la compuerta del servidor la acota igual.
 */
export function urlCorreccion(urlMedicion: string): string {
  const url = new URL(urlMedicion);
  url.pathname = url.pathname.replace(/\/ia\/(caderas|pierna)$/, '/ia/$1/correccion');
  return url.toString();
}

/**
 * Si el radiólogo movió algún punto más de `tolerancia` píxeles. Por debajo es
 * ruido de redondeo (mundo ↔ imagen), no una corrección.
 */
export function cambiaron(a: Tres, b: Tres, tolerancia = 0.5): boolean {
  return a.some((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) > tolerancia);
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
