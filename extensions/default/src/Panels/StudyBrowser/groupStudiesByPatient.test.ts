import { groupStudiesByPatient } from './groupStudiesByPatient';

const study = (uid, patientId, extra = {}) => ({
  studyInstanceUid: uid,
  patientId,
  patientName: `PACIENTE^${patientId}`,
  date: '2026-10-07',
  description: `estudio ${uid}`,
  displaySets: [],
  ...extra,
});

const tab = studies => [{ name: 'all', label: 'All', studies }];

describe('groupStudiesByPatient', () => {
  it('pone arriba el estudio en pantalla y los del mismo paciente', () => {
    const [{ studies }] = groupStudiesByPatient(
      tab([study('previo', 'A'), study('otro', 'B'), study('actual', 'A')]),
      { activeStudyInstanceUID: 'actual', arrivalOrder: ['actual', 'otro'] }
    );

    expect(studies.map(s => [s.studyInstanceUid, s.group])).toEqual([
      ['actual', 'patient'],
      ['previo', 'patient'],
      ['otro', 'queue'],
    ]);
  });

  it('ordena la cola por orden de llegada, no por fecha', () => {
    const [{ studies }] = groupStudiesByPatient(
      tab([study('actual', 'A'), study('segundo', 'C'), study('primero', 'B')]),
      { activeStudyInstanceUID: 'actual', arrivalOrder: ['actual', 'primero', 'segundo'] }
    );

    expect(studies.filter(s => s.group === 'queue').map(s => s.studyInstanceUid)).toEqual([
      'primero',
      'segundo',
    ]);
  });

  it('deja fuera los previos de otros pacientes que nadie cargó', () => {
    const [{ studies }] = groupStudiesByPatient(
      tab([study('actual', 'A'), study('cargado', 'B'), study('previo-de-B', 'B')]),
      { activeStudyInstanceUID: 'actual', arrivalOrder: ['actual', 'cargado'] }
    );

    expect(studies.map(s => s.studyInstanceUid)).toEqual(['actual', 'cargado']);
  });

  it('a los de la cola les antepone el nombre del paciente', () => {
    const [{ studies }] = groupStudiesByPatient(
      tab([study('actual', 'A'), study('otro', 'B')]),
      { activeStudyInstanceUID: 'actual', arrivalOrder: ['otro'] }
    );

    expect(studies[1].description).toBe('PACIENTE B · estudio otro');
  });

  it('sin ID de paciente no supone que dos estudios son del mismo', () => {
    const [{ studies }] = groupStudiesByPatient(
      tab([study('actual', undefined), study('otro', undefined)]),
      { activeStudyInstanceUID: 'actual', arrivalOrder: ['actual', 'otro'] }
    );

    expect(studies.map(s => s.group)).toEqual(['patient', 'queue']);
  });

  it('sin estudio en pantalla deja las pestañas como venían', () => {
    const tabs = tab([study('uno', 'A'), study('dos', 'B')]);

    expect(groupStudiesByPatient(tabs, { activeStudyInstanceUID: undefined, arrivalOrder: [] })).toBe(
      tabs
    );
  });
});
