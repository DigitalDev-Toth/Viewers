import {
  angulosCaderas,
  avisoDeError,
  caderaDeLaIzquierda,
  cambiaron,
  etiqueta,
  urlCorreccion,
  urlMedicion,
  type Tres,
} from './medicion';

const WADO =
  'dicomweb:https://ohif.cui.date/api/wado?requestType=WADO&studyUID=1.2.3&seriesUID=1.2.4&objectUID=1.2.5&client=csf' +
  '&contentType=application/dicom&transferSyntax=*';
const INSTANCIA = { Rows: 2328, Columns: 2846, PhotometricInterpretation: 'MONOCHROME1' };

/** El ángulo en el punto del medio, como lo calcula la herramienta Ángulo de Cornerstone. */
function anguloAlMedio([a, b, c]: number[][]): number {
  const v1 = [b[0] - a[0], b[1] - a[1]];
  const v2 = [b[0] - c[0], b[1] - c[1]];
  const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** El índice como lo define el modelo (iaTunning/scripts/eval_caderas.indice_acetabular). */
function indice(tcc: number[], asm: number[], otro: number[]): number {
  const h = [tcc[0] - otro[0], tcc[1] - otro[1]];
  const r = [asm[0] - tcc[0], asm[1] - tcc[1]];
  return (
    (Math.acos((h[0] * r[0] + h[1] * r[1]) / (Math.hypot(...h) * Math.hypot(...r))) * 180) / Math.PI
  );
}

describe('urlMedicion', () => {
  it('pone la medición al lado de /wado, con los UID y el tamaño del DICOM', () => {
    const url = new URL(urlMedicion(WADO, INSTANCIA));

    expect(url.origin + url.pathname).toBe('https://ohif.cui.date/api/ia/caderas');
    expect(url.searchParams.get('client')).toBe('csf');
    expect(url.searchParams.get('objectUID')).toBe('1.2.5');
    expect(url.searchParams.get('filas')).toBe('2328');
    expect(url.searchParams.get('columnas')).toBe('2846');
    expect(url.searchParams.get('fotometria')).toBe('MONOCHROME1');
    // Lo que es de la imagen no viaja.
    expect(url.searchParams.get('contentType')).toBeNull();
  });

  it('en desarrollo apunta al proxy local', () => {
    const local = WADO.replace('https://ohif.cui.date/api', 'http://localhost:3001');

    expect(urlMedicion(local, INSTANCIA)).toMatch(/^http:\/\/localhost:3001\/ia\/caderas\?/);
  });

  it('no inventa un pedido para lo que no viene del WADO del centro', () => {
    expect(
      urlMedicion('wadors:https://x/studies/1/series/2/instances/3/frames/1', INSTANCIA)
    ).toBeNull();
    expect(urlMedicion(WADO.replace('&client=csf', ''), INSTANCIA)).toBeNull();
    expect(urlMedicion(WADO, { Rows: 2328 })).toBeNull();
    expect(urlMedicion(undefined, INSTANCIA)).toBeNull();
  });
});

describe('angulosCaderas', () => {
  // Una pelvis un poco rotada: Hilgenreiner no es horizontal.
  const puntos = {
    tcc_izq: [400, 520] as [number, number],
    asm_izq: [250, 455] as [number, number],
    tcc_der: [800, 540] as [number, number],
    asm_der: [960, 500] as [number, number],
  };

  it('la herramienta Ángulo muestra exactamente el índice acetabular de cada lado', () => {
    const { izq, der } = angulosCaderas(puntos);

    expect(anguloAlMedio(izq)).toBeCloseTo(
      indice(puntos.tcc_izq, puntos.asm_izq, puntos.tcc_der),
      6
    );
    expect(anguloAlMedio(der)).toBeCloseTo(
      indice(puntos.tcc_der, puntos.asm_der, puntos.tcc_izq),
      6
    );
  });

  it('el vértice es el cartílago y el otro extremo, el techo', () => {
    const { izq, der } = angulosCaderas(puntos);

    expect(izq[1]).toEqual(puntos.tcc_izq);
    expect(izq[2]).toEqual(puntos.asm_izq);
    expect(der[1]).toEqual(puntos.tcc_der);
    expect(der[2]).toEqual(puntos.asm_der);
  });

  it('Hilgenreiner se prolonga hacia afuera de cada lado', () => {
    const { izq, der } = angulosCaderas(puntos);

    expect(izq[0][0]).toBeLessThan(puntos.tcc_izq[0]);
    expect(der[0][0]).toBeGreaterThan(puntos.tcc_der[0]);
  });
});

describe('caderaDeLaIzquierda', () => {
  it('en una AP habitual, la izquierda de la imagen es la cadera derecha del paciente', () => {
    expect(caderaDeLaIzquierda('L\\F')).toBe('derecha');
    expect(caderaDeLaIzquierda(undefined)).toBe('derecha');
  });

  it('con la placa volteada, al revés', () => {
    expect(caderaDeLaIzquierda('R\\F')).toBe('izquierda');
  });

  it('la etiqueta dice que es del paciente', () => {
    expect(etiqueta('derecha')).toBe('IA · cadera derecha (paciente)');
  });
});

describe('avisoDeError', () => {
  it('distingue «no es una pelvis» de un problema del camino', () => {
    expect(avisoDeError(422, { motivo: 'techo acetabular degenerado' })).toMatch(
      /no reconoce una pelvis AP/
    );
    expect(avisoDeError(403, { error: 'el enlace no autoriza ese estudio' })).toMatch(
      /no autoriza/
    );
    expect(
      avisoDeError(503, { motivo: 'la medición con IA no está configurada en este visor' })
    ).toMatch(/no está configurada/);
  });
});

describe('correcciones', () => {
  it('van al lado de la medición, con la misma query', () => {
    const medicion = urlMedicion(WADO, INSTANCIA);
    const url = new URL(urlCorreccion(medicion));

    expect(url.pathname).toBe('/api/ia/caderas/correccion');
    expect(url.search).toBe(new URL(medicion).search);
  });

  it('sólo cuenta como cambio lo que pasa del redondeo', () => {
    const a: Tres = [
      [100, 500],
      [400, 520],
      [250, 455],
    ];
    const casi: Tres = [
      [100.3, 500],
      [400, 520.2],
      [250, 455],
    ];
    const movido: Tres = [
      [100, 500],
      [400, 520],
      [252, 455],
    ];

    expect(cambiaron(casi, a)).toBe(false);
    expect(cambiaron(movido, a)).toBe(true);
  });
});
