import { isPriorOf } from './studyAttributes';

const estudio = (uid, paciente) => ({ StudyInstanceUID: uid, PatientID: paciente });

describe('isPriorOf', () => {
  it('es previa otro estudio del mismo paciente', () => {
    expect(isPriorOf(estudio('previa', 'A'), estudio('actual', 'A'))).toBe(true);
  });

  it('el estudio de otro paciente en la cola no es previa', () => {
    expect(isPriorOf(estudio('cola', 'B'), estudio('actual', 'A'))).toBe(false);
  });

  it('el estudio activo no es previa de sí mismo', () => {
    expect(isPriorOf(estudio('actual', 'A'), estudio('actual', 'A'))).toBe(false);
  });

  it('sin ID de paciente no se supone que es el mismo', () => {
    expect(isPriorOf(estudio('x', undefined), estudio('actual', undefined))).toBe(false);
  });

  it('lee el paciente de la primera instancia si el estudio no lo trae', () => {
    const conSeries = (uid, paciente) => ({
      StudyInstanceUID: uid,
      series: [{ instances: [{ PatientID: paciente }] }],
    });
    expect(isPriorOf(conSeries('previa', 'A'), conSeries('actual', 'A'))).toBe(true);
  });
});
