import {
  formatAge,
  formatDate,
  formatTime,
  laterality,
  mergeTags,
  TOP_LEFT,
  TOP_RIGHT,
  type Tags,
} from './patientData';

const formatPN = (pn: string) => pn.replace('^', ', ');
const lineText = (lines, id: string, tags: Tags) =>
  lines.find(line => line.id === id).text(tags, formatPN);

describe('mergeTags', () => {
  it('lo del manifiesto manda: el índice ya limpió los nombres', () => {
    expect(mergeTags({ PatientName: 'PÉREZ^JUANA' }, { PatientName: 'PÃ‰REZ^JUANA' })).toEqual({
      PatientName: 'PÉREZ^JUANA',
    });
  });

  it('el archivo completa lo que el manifiesto no trae', () => {
    expect(
      mergeTags({ PatientID: '7' }, { PatientBirthDate: '19700315', InstitutionName: 'CUIDATE' })
    ).toEqual({ PatientID: '7', PatientBirthDate: '19700315', InstitutionName: 'CUIDATE' });
  });

  it('un valor vacío o con espacios no tapa al otro', () => {
    expect(mergeTags({ PatientSex: '  ' }, { PatientSex: 'F' })).toEqual({ PatientSex: 'F' });
  });

  it('lee los valores naturalizados: PN como objeto, números, listas', () => {
    expect(
      mergeTags(
        {
          PatientName: { Alphabetic: 'SOTO^LUIS' },
          SeriesNumber: 3,
          ViewPosition: ['CC'],
        } as never,
        {}
      )
    ).toEqual({ PatientName: 'SOTO^LUIS', SeriesNumber: '3', ViewPosition: 'CC' });
  });
});

describe('fechas y horas', () => {
  it('día-mes-año, venga como DA o como fecha ISO', () => {
    expect(formatDate('20261017')).toBe('17-10-2026');
    expect(formatDate('2026-10-17')).toBe('17-10-2026');
  });

  it('una fecha rota no se muestra', () => {
    expect(formatDate('')).toBeUndefined();
    expect(formatDate('20261399')).toBeUndefined();
  });

  it('horas y minutos, sin segundos ni fracciones', () => {
    expect(formatTime('103245.123456')).toBe('10:32');
    expect(formatTime('10:32:45')).toBe('10:32');
    expect(formatTime('9')).toBeUndefined();
  });
});

describe('formatAge', () => {
  it('la edad el día del estudio, no la de hoy', () => {
    expect(formatAge({ PatientBirthDate: '19700315', StudyDate: '20261017' })).toBe('56 años');
    expect(formatAge({ PatientBirthDate: '19701018', StudyDate: '20261017' })).toBe('55 años');
  });

  it('debajo de dos años en meses, debajo de un mes en días', () => {
    expect(formatAge({ PatientBirthDate: '20250501', StudyDate: '20261017' })).toBe('17 meses');
    expect(formatAge({ PatientBirthDate: '20260916', StudyDate: '20261017' })).toBe('1 mes');
    expect(formatAge({ PatientBirthDate: '20261005', StudyDate: '20261017' })).toBe('12 días');
  });

  it('sin nacimiento, la edad que trae el equipo', () => {
    expect(formatAge({ PatientAge: '045Y' })).toBe('45 años');
    expect(formatAge({ PatientAge: '008M' })).toBe('8 meses');
    expect(formatAge({ PatientAge: '001W' })).toBe('1 semana');
    expect(formatAge({ PatientAge: 'X' })).toBeUndefined();
  });

  it('un estudio anterior al nacimiento es un dato malo, no una edad', () => {
    expect(formatAge({ PatientBirthDate: '20300101', StudyDate: '20261017' })).toBeUndefined();
  });
});

describe('laterality', () => {
  it('la de la imagen, como Horos', () => {
    expect(laterality({ ImageLaterality: 'L', Laterality: 'R' })).toBe('L');
  });

  it('la de la serie cuando la imagen no la trae', () => {
    expect(laterality({ Laterality: 'R' })).toBe('R');
    expect(laterality({})).toBeUndefined();
  });
});

describe('las esquinas', () => {
  const tags: Tags = {
    PatientName: 'PÉREZ^JUANA',
    PatientID: '12.345.678-9',
    PatientSex: 'F',
    PatientBirthDate: '19700315',
    InstitutionName: 'Clínica Norte Imagen',
    StudyDate: '20261017',
    StudyTime: '103245',
    StudyDescription: 'MAMOGRAFÍA BILATERAL',
    AccessionNumber: 'A123',
    SeriesNumber: '2',
    SeriesDescription: 'R CC',
    ImageLaterality: 'R',
    ViewPosition: 'CC',
  };

  it('arriba a la izquierda, quién es', () => {
    expect(TOP_LEFT.map(line => line.id)).toEqual([
      'PatientName',
      'PatientIdentity',
      'InstitutionName',
    ]);
    expect(lineText(TOP_LEFT, 'PatientName', tags)).toBe('PÉREZ, JUANA');
    expect(lineText(TOP_LEFT, 'PatientIdentity', tags)).toBe(
      '12.345.678-9 · F · 15-03-1970 (56 años)'
    );
    expect(lineText(TOP_LEFT, 'InstitutionName', tags)).toBe('Clínica Norte Imagen');
  });

  it('arriba a la derecha, qué es, con la lateralidad primero', () => {
    expect(TOP_RIGHT.map(line => line.id)).toEqual([
      'Laterality',
      'StudyDateTime',
      'StudyDescription',
      'AccessionNumber',
      'Series',
    ]);
    expect(lineText(TOP_RIGHT, 'Laterality', tags)).toBe('R · CC');
    expect(lineText(TOP_RIGHT, 'StudyDateTime', tags)).toBe('17-10-2026 10:32');
    expect(lineText(TOP_RIGHT, 'AccessionNumber', tags)).toBe('Acc. A123');
    expect(lineText(TOP_RIGHT, 'Series', tags)).toBe('Serie 2 · R CC');
  });

  it('lo que falta no deja líneas vacías ni separadores sueltos', () => {
    const few: Tags = { PatientID: '7', StudyDate: '20261017' };
    expect(lineText(TOP_LEFT, 'PatientName', few)).toBeUndefined();
    expect(lineText(TOP_LEFT, 'PatientIdentity', few)).toBe('7');
    expect(lineText(TOP_LEFT, 'InstitutionName', few)).toBeUndefined();
    expect(lineText(TOP_RIGHT, 'Laterality', few)).toBeUndefined();
    expect(lineText(TOP_RIGHT, 'StudyDateTime', few)).toBe('17-10-2026');
    expect(lineText(TOP_RIGHT, 'Series', few)).toBeUndefined();
  });

  it('sin nacimiento pero con edad del equipo, la edad sola', () => {
    expect(lineText(TOP_LEFT, 'PatientIdentity', { PatientID: '7', PatientAge: '045Y' })).toBe(
      '7 · 45 años'
    );
  });

  it('una radiografía sin lateralidad muestra igual la proyección', () => {
    expect(lineText(TOP_RIGHT, 'Laterality', { ViewPosition: 'PA' })).toBe('PA');
  });
});
