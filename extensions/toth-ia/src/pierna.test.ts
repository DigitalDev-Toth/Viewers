import { urlCorreccion, urlMedicion, mmPorPixel } from './medicion';
import {
  anguloAlMedio,
  avisoErrorPierna,
  avisoPiernas,
  desnivel,
  desviacion,
  dondeTexto,
  esTelerradiografia,
  etiquetaDesnivel,
  etiquetaPierna,
  PREFIJOS_PIERNA,
  textoEje,
  textoPierna,
} from './pierna';

const WADO =
  'dicomweb:https://ohif.cui.date/api/wado?requestType=WADO&studyUID=1.2.3&seriesUID=1.2.4&objectUID=1.2.5&client=csf' +
  '&contentType=application/dicom&transferSyntax=*';
const PLACA = { Rows: 10500, Columns: 3500, PhotometricInterpretation: 'MONOCHROME1', PixelSpacing: [0.139, 0.139] };

// Una pierna en la mitad izquierda de la imagen: hacia afuera es -x.
const LATERAL_IZQ = [-1, 0, 0];

describe('esTelerradiografia', () => {
  it('reconoce una placa alta y no una pelvis', () => {
    expect(esTelerradiografia(PLACA)).toBe(true);
    expect(esTelerradiografia({ Rows: 2328, Columns: 2846 })).toBe(false);
    expect(esTelerradiografia({ Rows: 3000, Columns: 2000 })).toBe(false);
    expect(esTelerradiografia(undefined)).toBe(false);
  });
});

describe('la URL de la pierna', () => {
  it('va a /ia/pierna con el tamaño del píxel', () => {
    const url = new URL(urlMedicion(WADO, PLACA, 'pierna'));

    expect(url.pathname).toBe('/api/ia/pierna');
    expect(url.searchParams.get('mm')).toBe('0.139');
    expect(url.searchParams.get('filas')).toBe('10500');
    expect(url.searchParams.get('objectUID')).toBe('1.2.5');
  });

  it('el tamaño del píxel puede venir como texto DICOM, y la de caderas no lo lleva', () => {
    expect(mmPorPixel({ PixelSpacing: '0.1015\\0.1015' })).toBe(0.1015);
    expect(mmPorPixel({ PixelSpacing: 'nada' })).toBeNull();
    expect(mmPorPixel({})).toBeNull();
    expect(new URL(urlMedicion(WADO, PLACA)).searchParams.get('mm')).toBeNull();
  });

  it('la corrección va al lado de la medición', () => {
    const url = new URL(urlCorreccion(urlMedicion(WADO, PLACA, 'pierna')));
    expect(url.pathname).toBe('/api/ia/pierna/correccion');
    expect(url.searchParams.get('mm')).toBe('0.139');
  });
});

describe('desviacion del eje', () => {
  it('es 180° menos el ángulo en la rodilla, + en varo y − en valgo, como puntos_pierna.eje', () => {
    // Rodilla 10 px hacia el centro de la imagen (+x): en la pierna de la mitad izquierda es valgo.
    const valgo = [
      [100, 0, 0],
      [110, 500, 0],
      [100, 1000, 0],
    ];
    const esperado = 180 - anguloAlMedio(valgo);
    expect(esperado).toBeCloseTo(2.29, 2);
    expect(desviacion(valgo, LATERAL_IZQ)).toBeCloseTo(-esperado, 6);

    // La misma rodilla hacia afuera (-x): varo.
    const varo = valgo.map(([x, y, z]) => [200 - x, y, z]);
    expect(desviacion(varo, LATERAL_IZQ)).toBeCloseTo(esperado, 6);
    // Y en la pierna de la otra mitad, hacia afuera es +x: la primera es varo.
    expect(desviacion(valgo, [1, 0, 0])).toBeCloseTo(esperado, 6);
  });

  it('una pierna recta da 0°', () => {
    expect(
      desviacion(
        [
          [100, 0],
          [100, 500],
          [100, 1000],
        ],
        [-1, 0]
      )
    ).toBeCloseTo(0, 6);
  });
});

describe('los textos', () => {
  it('escribe el eje como lo informa el radiólogo', () => {
    expect(textoEje(3.04)).toBe('Eje 3,0° varo');
    expect(textoEje(-7.26)).toBe('Eje 7,3° valgo');
    expect(textoEje(0.01)).toBe('Eje 0°');
  });

  it('sólo cambia el texto de los ángulos de la IA', () => {
    const recto = [
      [0, 0, 0],
      [0, 100, 0],
      [100, 100, 0],
    ];
    expect(textoPierna({ ia: { medida: 'mldfa', mitad: 'izq', lateral: LATERAL_IZQ }, handles: { points: recto } })).toEqual([
      'mLDFA 90°',
    ]);
    expect(textoPierna({ ia: { medida: 'mpta', mitad: 'der', lateral: [1, 0, 0] }, handles: { points: recto } })).toEqual([
      'MPTA 90°',
    ]);
    expect(textoPierna({ handles: { points: recto } })).toBeNull();
    expect(textoPierna(undefined)).toBeNull();
  });

  it('el eje anatómico se escribe como el mecánico', () => {
    const valgo = [
      [100, 0, 0],
      [110, 500, 0],
      [100, 1000, 0],
    ];
    const ia = { medida: 'anatomico', mitad: 'izq', lateral: LATERAL_IZQ } as const;
    expect(textoPierna({ ia, handles: { points: valgo } })).toEqual(['Eje anatómico 2,3° valgo']);
    expect(textoEje(0, 'Eje anatómico')).toBe('Eje anatómico 0°');
  });

  it('los largos usan lo que calibró Longitud', () => {
    const linea = [
      [0, 0, 0],
      [0, 424.4, 0],
    ];
    const femur = { ia: { medida: 'femur', mitad: 'izq' } as const, handles: { points: linea } };
    expect(textoPierna(femur, { length: 424.4, unit: 'mm' })).toEqual(['Fémur 424 mm']);
    expect(textoPierna(femur, { length: 424.4, unit: 'mm Unknown' })).toEqual(['Fémur 424 mm']);
    expect(
      textoPierna({ ...femur, ia: { medida: 'tibia', mitad: 'der' } as const }, { length: 359.6, unit: 'mm' })
    ).toEqual(['Tibia 360 mm']);
    // Sin el largo todavía calculado, que lo escriba la herramienta.
    expect(textoPierna(femur, undefined)).toBeNull();
    expect(textoPierna(femur, { length: NaN, unit: 'mm' })).toBeNull();
  });

  it('el desnivel es la diferencia de altura, con la pierna más alta', () => {
    const abajo = [0, 1, 0];
    // De la cabeza de la mitad izquierda a la de la derecha: 180 de ancho, 4 más abajo la segunda.
    const puntos = [
      [100, 300, 0],
      [280, 304, 0],
    ];
    const largo = Math.hypot(180, 4);
    expect(desnivel(puntos, abajo, largo)).toEqual({ valor: expect.closeTo(4, 6), masAlto: 0 });
    const ia = { medida: 'cabezas', piernas: ['derecha', 'izquierda'], abajo } as const;
    expect(textoPierna({ ia, handles: { points: puntos } }, { length: largo, unit: 'mm' })).toEqual([
      'Desnivel de cabezas femorales: derecha 4 mm más alta',
    ]);
    const tibias = { medida: 'tibias', piernas: ['derecha', 'izquierda'], abajo } as const;
    const alReves = [
      [100, 304, 0],
      [280, 300, 0],
    ];
    expect(textoPierna({ ia: tibias, handles: { points: alReves } }, { length: largo, unit: 'mm' })).toEqual([
      'Desnivel de tibias: izquierda 4 mm más alta',
    ]);
    const parejo = [
      [100, 300, 0],
      [280, 300.2, 0],
    ];
    expect(textoPierna({ ia, handles: { points: parejo } }, { length: 180, unit: 'mm' })).toEqual([
      'Desnivel de cabezas femorales: 0 mm',
    ]);
  });

  it('los recuadros nuevos van hacia afuera de cada pierna o entre las dos', () => {
    // 0,2 mm/px: 30 mm son 150 px.
    expect(dondeTexto('femur', [[100, 0], [100, 2000]], 'izq', 0.2)).toEqual([-50, 1000]);
    expect(dondeTexto('tibia', [[900, 0], [900, 2000]], 'der', 0.2)).toEqual([1050, 1000]);
    expect(dondeTexto('cabezas', [[100, 500], [900, 500]], null, 0.2)).toEqual([300, 600]);
    expect(dondeTexto('eje', [[0, 0], [0, 1], [0, 2]], 'izq', 0.2)).toBeNull();
  });

  it('las etiquetas dicen la pierna del paciente y se reconocen para reemplazarlas', () => {
    const e = etiquetaPierna('mpta', 'izquierda');
    expect(e).toBe('IA · MPTA pierna izquierda (paciente)');
    for (const nueva of [
      etiquetaPierna('anatomico', 'derecha'),
      etiquetaPierna('femur', 'derecha'),
      etiquetaPierna('tibia', 'izquierda'),
      etiquetaDesnivel('cabezas'),
      etiquetaDesnivel('tibias'),
    ]) {
      expect(PREFIJOS_PIERNA.some(p => nueva.startsWith(p))).toBe(true);
    }
    expect(PREFIJOS_PIERNA.some(p => e.startsWith(p))).toBe(true);
    expect(PREFIJOS_PIERNA.some(p => 'IA · cadera derecha (paciente)'.startsWith(p))).toBe(false);
  });

  it('avisa qué pierna no se midió y por qué', () => {
    const lado = { izq: 'derecha', der: 'izquierda' } as const;
    expect(avisoPiernas({ izq: { ok: true }, der: { ok: true } }, lado).tipo).toBe('success');
    const r = avisoPiernas({ izq: { ok: true }, der: { ok: false, motivo: 'eje fuera de rango' } }, lado);
    expect(r.tipo).toBe('warning');
    expect(r.mensaje).toContain('la pierna izquierda no se midió (eje fuera de rango)');
    expect(avisoErrorPierna(422, { motivo: 'x' })).toContain('pierna completa');
    expect(avisoErrorPierna(403, null)).toContain('no autoriza');
  });
});
