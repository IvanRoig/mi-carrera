import { describe, it, expect } from 'vitest';
import { termToClipboardText, type TermItem } from './exportTerm';
import type { Commission } from '@/domain/conflicts';

function comm(id: string, day: number, start: string, end: string): Commission {
  return { id, modality: 'presencial', meetings: [{ day, start, end }] };
}

describe('termToClipboardText', () => {
  it('arma el formato de inscripción agrupado por día (y turno si se repite)', () => {
    const items: TermItem[] = [
      { code: '03648', name: 'Diseño de Software', commission: comm('1900', 0, '19:00', '23:00') },
      { code: '03646', name: 'Paradigmas de Programación', commission: comm('2900', 1, '19:00', '23:00') },
      { code: '03656', name: 'Estadística Aplicada', commission: comm('4900', 3, '19:00', '23:00') },
      { code: '03676', name: 'RSU', commission: comm('5300', 4, '08:00', '12:00') },
      { code: '03675', name: 'Práctica Profesional Supervisada', commission: comm('5600', 4, '14:00', '18:00') },
      { code: '03643', name: 'Redes de Computadoras', commission: comm('5900', 4, '19:00', '23:00') },
    ];
    const txt = termToClipboardText(items);
    expect(txt).toBe(
      [
        '*Lunes*',
        'Diseño de Software',
        'Cod Mat: 3648',
        'Cod Com: 1900 (Lu 19-23)',
        '-----------------------------------------',
        '*Martes*',
        'Paradigmas de Programación',
        'Cod Mat: 3646',
        'Cod Com: 2900 (Ma 19-23)',
        '-----------------------------------------',
        '*Jueves*',
        'Estadística Aplicada',
        'Cod Mat: 3656',
        'Cod Com: 4900 (Ju 19-23)',
        '-----------------------------------------',
        '*Viernes Mañana*',
        'RSU',
        'Cod Mat: 3676',
        'Cod Com: 5300 (Vi 08-12)',
        '-----------------------------------------',
        '*Viernes Tarde*',
        'Práctica Profesional Supervisada',
        'Cod Mat: 3675',
        'Cod Com: 5600 (Vi 14-18)',
        '-----------------------------------------',
        '*Viernes Noche*',
        'Redes de Computadoras',
        'Cod Mat: 3643',
        'Cod Com: 5900 (Vi 19-23)',
      ].join('\n'),
    );
  });

  it('una electiva usa el código REAL de la electiva, no el del cupo del plan', () => {
    const items: TermItem[] = [
      {
        code: '03672', // cupo "Electiva I" del plan
        name: 'Visión Artificial',
        commission: {
          ...comm('4900', 3, '19:00', '23:00'),
          label: 'Visión Artificial',
          subjectCode: '03679',
        },
      },
    ];
    const txt = termToClipboardText(items);
    expect(txt).toContain('Cod Mat: 3679');
    expect(txt).toContain('Cod Com: 4900 (Ju 19-23)');
  });

  it('las comisiones sin código real quedan "a confirmar"', () => {
    const items: TermItem[] = [
      {
        code: '03673',
        name: 'Informática Biomédica',
        commission: { ...comm('electiva-1', 1, '19:00', '23:00'), label: 'Informática Biomédica' },
      },
    ];
    const txt = termToClipboardText(items);
    expect(txt).toContain('Cod Com: a confirmar (Ma 19-23)');
  });

  it('una materia sin comisión pero con día forzado (verano) sale con su día', () => {
    const items: TermItem[] = [{ code: '03640', name: 'Algoritmos', day: 1, turno: 'n' }];
    const txt = termToClipboardText(items);
    expect(txt).toContain('*Martes*');
    expect(txt).toContain('Cod Com: a confirmar (Ma (a confirmar))');
  });

  it('incluye el título cuando se pasa', () => {
    const txt = termToClipboardText(
      [{ code: '03648', name: 'Diseño de Software', commission: comm('1900', 0, '19:00', '23:00') }],
      '1° cuatri 2027',
    );
    expect(txt.startsWith('*1° cuatri 2027*\n')).toBe(true);
  });
});
