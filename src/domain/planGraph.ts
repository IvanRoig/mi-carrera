/** Grafo del plan real, construido una sola vez y reutilizado en toda la app. */
import { subjects } from '@/data/plan';
import { buildGraph } from './graph';

export const graph = buildGraph(subjects);
