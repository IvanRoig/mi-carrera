import { getSubject } from '@/data/plan';
import { useStore } from '@/store/useStore';

/** Nombre de una materia, aplicando el nombre custom de electiva si existe. */
export function useSubjectName() {
  const electiveNames = useStore((s) => s.electiveNames);
  return (code: string): string => {
    const s = getSubject(code);
    if (!s) return code;
    if (s.isElective && electiveNames[code]) return electiveNames[code];
    return s.name;
  };
}
