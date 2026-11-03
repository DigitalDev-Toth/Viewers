/**
 * Los ángulos de cadera contra la herramienta Cobb de verdad: el
 * `_calculateCachedStats` de CobbAngleTool (@cornerstonejs/tools 5.6.12), que
 * es lo que el radiólogo ve escrito en la imagen. Aparte de medicion.test.ts
 * porque carga Cornerstone.
 */
import { eventTarget } from '@cornerstonejs/core';
import { CobbAngleTool, Enums, annotation as csAnnotation } from '@cornerstonejs/tools';

import { compartirHilgenreiner, escucharHilgenreiner } from './hilgenreiner';
import {
  angulosCaderas,
  cobbCaderas,
  tresDesdeCobb,
  type Cuatro,
  type Mitad,
  type Punto,
  type Puntos,
  type Tres,
} from './medicion';

// CobbAngleTool calcula con gl-matrix en float32 (~1e-6°) y escribe dos decimales.
const DECIMALES = 4;

/** El ángulo que escribe CobbAngleTool para estos cuatro puntos del mundo. */
function anguloCobb(puntos: number[][]): number {
  const herramienta = new CobbAngleTool() as unknown as {
    _calculateCachedStats: (anotacion: unknown, motor: unknown, elemento: unknown) => void;
  };
  const anotacion = {
    data: {
      handles: { points: puntos.map(([x, y, z = 0]) => [x, y, z]) },
      cachedStats: { imagen: {} as { angle?: number } },
    },
    invalidated: false,
  };
  // El canvas sólo se usa para los arcos; el ángulo sale de los puntos del mundo.
  const viewport = {
    element: null,
    worldToCanvas: (p: number[]) => [p[0], p[1]],
    canvasToWorld: (p: number[]) => [p[0], p[1], 0],
  };
  herramienta._calculateCachedStats(anotacion, null, { viewport });
  return anotacion.data.cachedStats.imagen.angle;
}

/** El índice como lo define el modelo (iaTunning/scripts/eval_caderas.indice_acetabular). */
function indice(tcc: Punto, asm: Punto, otro: Punto): number {
  const h = [tcc[0] - otro[0], tcc[1] - otro[1]];
  const r = [asm[0] - tcc[0], asm[1] - tcc[1]];
  return (
    (Math.acos((h[0] * r[0] + h[1] * r[1]) / (Math.hypot(...h) * Math.hypot(...r))) * 180) / Math.PI
  );
}

/** El ángulo en el punto del medio: el que guardan las correcciones (correcciones_caderas.angulo). */
function anguloAlMedio([a, b, c]: Tres): number {
  const u = [a[0] - b[0], a[1] - b[1]];
  const v = [c[0] - b[0], c[1] - b[1]];
  return (
    (Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))) * 180) / Math.PI
  );
}

/** Píxel → mundo como en una DX: origen, PixelSpacing y un plano que no es el de los ejes. */
function mundo([x, y]: Punto): number[] {
  const mm = 0.139;
  const fila = [0.6, 0.8, 0];
  const columna = [0, 0, 1];
  return [0, 1, 2].map(k => [-120, 35, 900][k] + mm * (x * fila[k] + y * columna[k]));
}

const girar = (p: Puntos, grados: number): Puntos => {
  const a = (grados * Math.PI) / 180;
  const g = ([x, y]: Punto): Punto => [
    1000 + (x - 1000) * Math.cos(a) - (y - 800) * Math.sin(a),
    800 + (x - 1000) * Math.sin(a) + (y - 800) * Math.cos(a),
  ];
  return {
    tcc_izq: g(p.tcc_izq),
    asm_izq: g(p.asm_izq),
    tcc_der: g(p.tcc_der),
    asm_der: g(p.asm_der),
  };
};

const RECTA: Puntos = {
  tcc_izq: [600, 800],
  asm_izq: [380, 760],
  tcc_der: [1400, 800],
  asm_der: [1620, 750],
};

const PELVIS: Record<string, Puntos> = {
  'un poco rotada': {
    tcc_izq: [400, 520],
    asm_izq: [250, 455],
    tcc_der: [800, 540],
    asm_der: [960, 500],
  },
  'displasia de un lado': {
    tcc_izq: [700, 1100],
    asm_izq: [460, 900],
    tcc_der: [1500, 1090],
    asm_der: [1760, 1010],
  },
  'casi plana': {
    tcc_izq: [600, 800],
    asm_izq: [380, 778],
    tcc_der: [1400, 800],
    asm_der: [1620, 777],
  },
  'inclinada 12°': girar(RECTA, 12),
  'inclinada −20°': girar(RECTA, -20),
  'índice de 55°': {
    tcc_izq: [600, 800],
    asm_izq: [460, 600],
    tcc_der: [1400, 800],
    asm_der: [1540, 600],
  },
  // Lo más que dibuja el servicio (ANGULO_MAX en servicio_caderas.py).
  'índice de 60°': {
    tcc_izq: [600, 800],
    asm_izq: [500, 800 - 100 * Math.sqrt(3)],
    tcc_der: [1400, 800],
    asm_der: [1500, 800 - 100 * Math.sqrt(3)],
  },
};

const OTRO: Record<Mitad, Mitad> = { izq: 'der', der: 'izq' };

describe('Cobb en las caderas', () => {
  for (const [nombre, p] of Object.entries(PELVIS)) {
    it(`muestra exactamente el índice del modelo (${nombre})`, () => {
      const cobb = cobbCaderas(p);
      for (const mitad of ['izq', 'der'] as const) {
        const esperado = indice(p[`tcc_${mitad}`], p[`asm_${mitad}`], p[`tcc_${OTRO[mitad]}`]);

        expect(anguloCobb(cobb[mitad])).toBeCloseTo(esperado, DECIMALES);
        // Y en el mundo del visor, que es donde mide Cornerstone.
        expect(anguloCobb(cobb[mitad].map(mundo))).toBeCloseTo(esperado, DECIMALES);
      }
    });
  }

  it('Hilgenreiner es la misma en las dos caderas y pasa por los dos cartílagos', () => {
    const p = PELVIS['un poco rotada'];
    const { izq, der } = cobbCaderas(p);
    const [a, b] = izq;

    expect(der[0]).toEqual(a);
    expect(der[1]).toEqual(b);
    expect(izq[0]).not.toBe(der[0]); // copias, no el mismo arreglo
    for (const tcc of [p.tcc_izq, p.tcc_der]) {
      const cruz = (b[0] - a[0]) * (tcc[1] - a[1]) - (b[1] - a[1]) * (tcc[0] - a[0]);
      expect(Math.abs(cruz)).toBeLessThan(1e-6);
      expect(tcc[0]).toBeGreaterThan(a[0]);
      expect(tcc[0]).toBeLessThan(b[0]);
    }
    // El techo, del cartílago al borde.
    expect(izq.slice(2)).toEqual([p.tcc_izq, p.asm_izq]);
    expect(der.slice(2)).toEqual([p.tcc_der, p.asm_der]);
  });

  it('dentro de cada Cobb no hay vértice compartido: los cuatro puntos se toman por separado', () => {
    for (const p of Object.values(PELVIS)) {
      for (const cuatro of Object.values(cobbCaderas(p))) {
        for (let i = 0; i < 4; i++) {
          for (let j = i + 1; j < 4; j++) {
            expect(
              Math.hypot(cuatro[i][0] - cuatro[j][0], cuatro[i][1] - cuatro[j][1])
            ).toBeGreaterThan(20);
          }
        }
      }
    }
  });

  it('con Hilgenreiner de un cartílago al otro, Cobb mostraría 180° menos el índice', () => {
    const p = PELVIS['un poco rotada'];
    const esperado = indice(p.tcc_der, p.asm_der, p.tcc_izq);

    expect(anguloCobb([p.tcc_izq, p.tcc_der, p.tcc_der, p.asm_der])).toBeCloseTo(
      180 - esperado,
      DECIMALES
    );
  });
});

describe('las correcciones vuelven a los tres puntos', () => {
  const p = PELVIS['displasia de un lado'];
  const tres = angulosCaderas(p).izq;
  const largo = Math.hypot(tres[0][0] - tres[1][0], tres[0][1] - tres[1][1]);
  const ia = cobbCaderas(p).izq;
  const techo = Math.hypot(p.asm_izq[0] - p.tcc_izq[0], p.asm_izq[1] - p.tcc_izq[1]);

  const mover = (cuatro: Cuatro, i: number, dx: number, dy: number): Cuatro =>
    cuatro.map((q, k) => (k === i ? [q[0] + dx, q[1] + dy] : q)) as Cuatro;
  /** Deja el extremo de Hilgenreiner de esta cadera a `techos` techos del cartílago. */
  const prolongacion = (techos: number): Cuatro => {
    const [a, , tcc] = ia;
    const d = Math.hypot(a[0] - tcc[0], a[1] - tcc[1]);
    const k = (techos * techo) / d;
    return [[tcc[0] + k * (a[0] - tcc[0]), tcc[1] + k * (a[1] - tcc[1])], ia[1], ia[2], ia[3]];
  };

  it('sin tocar nada, salen los mismos puntos de la IA', () => {
    const vuelta = tresDesdeCobb(ia, largo);
    vuelta.forEach((q, i) => {
      expect(q[0]).toBeCloseTo(tres[i][0], 9);
      expect(q[1]).toBeCloseTo(tres[i][1], 9);
    });
  });

  const correcciones: Record<string, Cuatro> = {
    'mueve el cartílago': mover(ia, 2, 12, -9),
    'mueve el techo': mover(ia, 3, -15, 20),
    'gira Hilgenreiner desde su extremo': mover(ia, 0, 0, 40),
    'gira Hilgenreiner desde el otro lado': mover(ia, 1, 0, -40),
    'corre Hilgenreiner en paralelo': mover(mover(ia, 0, 0, 30), 1, 0, 30),
    'acorta la prolongación a un techo': prolongacion(1),
    'la deja en un cuarto de techo': prolongacion(0.25),
    'arrastra el techo por encima de Hilgenreiner': mover(ia, 3, 300, 260),
  };

  for (const [nombre, cuatro] of Object.entries(correcciones)) {
    it(`se guarda el ángulo que vio el radiólogo (${nombre})`, () => {
      const vuelta = tresDesdeCobb(cuatro, largo);

      expect(anguloAlMedio(vuelta)).toBeCloseTo(anguloCobb(cuatro), DECIMALES);
      expect(vuelta[1]).toEqual(cuatro[2]);
      expect(vuelta[2]).toEqual(cuatro[3]);
      expect(Math.hypot(vuelta[0][0] - vuelta[1][0], vuelta[0][1] - vuelta[1][1])).toBeCloseTo(
        largo,
        6
      );
    });
  }

  it('las correcciones habituales siguen mostrando un índice, no 180° menos', () => {
    for (const nombre of [
      'mueve el cartílago',
      'mueve el techo',
      'gira Hilgenreiner desde su extremo',
      'gira Hilgenreiner desde el otro lado',
      'corre Hilgenreiner en paralelo',
      'acorta la prolongación a un techo',
    ]) {
      expect(anguloCobb(correcciones[nombre])).toBeLessThan(60);
    }
  });

  it('con la prolongación casi en el cartílago pasa a 180° menos, y eso es lo que se guarda', () => {
    const cuatro = correcciones['la deja en un cuarto de techo'];

    expect(anguloCobb(cuatro)).toBeCloseTo(180 - anguloCobb(ia), DECIMALES);
    expect(anguloAlMedio(tresDesdeCobb(cuatro, largo))).toBeCloseTo(anguloCobb(cuatro), DECIMALES);
  });

  it('replica el emparejamiento de Cornerstone con dos líneas cualesquiera', () => {
    let semilla = 7;
    const azar = () => {
      semilla = (semilla * 16807) % 2147483647;
      return (semilla / 2147483647) * 2000;
    };
    for (let n = 0; n < 300; n++) {
      const cuatro = Array.from({ length: 4 }, () => [azar(), azar()]) as Cuatro;

      expect(anguloAlMedio(tresDesdeCobb(cuatro, 100))).toBeCloseTo(anguloCobb(cuatro), DECIMALES);
    }
  });
});

describe('la Hilgenreiner compartida', () => {
  const p = PELVIS['un poco rotada'];
  let n = 0;
  const crear = (cuatro: Cuatro) => {
    const anotacion = {
      annotationUID: `00000000-0000-4000-8000-00000000000${n++}`,
      metadata: { toolName: CobbAngleTool.toolName, FrameOfReferenceUID: 'FOR' },
      data: { handles: { points: cuatro.map(([x, y]) => [x, y, 0]) }, cachedStats: {} },
      invalidated: false,
    };
    csAnnotation.state.addAnnotation(anotacion as never, 'FOR');
    return anotacion;
  };
  const avisos: string[] = [];
  const oir = (evt: Event) => avisos.push((evt as CustomEvent).detail.annotation.annotationUID);

  beforeAll(() => {
    escucharHilgenreiner();
    eventTarget.addEventListener(Enums.Events.ANNOTATION_MODIFIED, oir);
  });
  afterAll(() => eventTarget.removeEventListener(Enums.Events.ANNOTATION_MODIFIED, oir));
  beforeEach(() => (avisos.length = 0));

  it('mover la copia de una cadera mueve la de la otra, que avisa su cambio', () => {
    const { izq, der } = cobbCaderas(p);
    const a = crear(izq);
    const b = crear(der);
    compartirHilgenreiner(a.annotationUID, b.annotationUID, 'cuadro');

    a.data.handles.points[0] = [izq[0][0], izq[0][1] + 40, 0];
    csAnnotation.state.triggerAnnotationModified(
      a as never,
      undefined,
      Enums.ChangeTypes.HandlesUpdated
    );

    expect(b.data.handles.points[0]).toEqual(a.data.handles.points[0]);
    expect(b.data.handles.points[0]).not.toBe(a.data.handles.points[0]);
    expect(b.data.handles.points[1]).toEqual(a.data.handles.points[1]);
    expect(b.data.handles.points.slice(2)).toEqual(der.slice(2).map(([x, y]) => [x, y, 0]));
    expect(b.invalidated).toBe(true);
    // Un aviso por cadera: la copia de vuelta no vuelve a disparar nada.
    expect([...avisos].sort()).toEqual([a.annotationUID, b.annotationUID].sort());
  });

  it('mover un techo no toca la otra cadera', () => {
    const { izq, der } = cobbCaderas(p);
    const a = crear(izq);
    const b = crear(der);
    compartirHilgenreiner(a.annotationUID, b.annotationUID, 'cuadro');

    a.data.handles.points[3] = [izq[3][0] + 9, izq[3][1], 0];
    csAnnotation.state.triggerAnnotationModified(
      a as never,
      undefined,
      Enums.ChangeTypes.HandlesUpdated
    );

    expect(b.data.handles.points).toEqual(der.map(([x, y]) => [x, y, 0]));
    expect(avisos).toEqual([a.annotationUID]);
  });

  it('borrada una cadera, la otra queda suelta', () => {
    const { izq, der } = cobbCaderas(p);
    const a = crear(izq);
    const b = crear(der);
    compartirHilgenreiner(a.annotationUID, b.annotationUID, 'cuadro');
    csAnnotation.state.removeAnnotation(a.annotationUID);
    avisos.length = 0;

    b.data.handles.points[1] = [der[1][0], der[1][1] - 30, 0];
    csAnnotation.state.triggerAnnotationModified(
      b as never,
      undefined,
      Enums.ChangeTypes.HandlesUpdated
    );

    expect(avisos).toEqual([b.annotationUID]);
  });
});
