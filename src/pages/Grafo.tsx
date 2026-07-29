import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Position,
  type Node,
  type Edge,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { subjects } from '@/data/plan';
import { graph } from '@/domain/planGraph';
import { upstreamDepth, ancestorsOf, descendantsOf } from '@/domain/graph';
import { useDerived } from '@/lib/useDerived';
import { useStore } from '@/store/useStore';
import { STATUS_COLOR, STATUS_LABEL, trackColor } from '@/lib/ui';
import type { SubjectStatus } from '@/domain/types';
import { useSubjectName } from '@/lib/subjectName';

// Layout por nivel de correlatividad (izq→der) calculado una vez.
const LEVELS = upstreamDepth(graph);
const X_GAP = 240;
const Y_GAP = 74;

/** Colores por año (1° a 5°). */
const YEAR_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185'];

/**
 * Layout por niveles (izq→der) ordenando cada columna con el método del
 * baricentro (Sugiyama): cada materia se acerca al promedio de sus correlativas,
 * ida y vuelta varias veces. Reduce muchísimo el cruce de flechas.
 */
const positions = (() => {
  const byLevel = new Map<number, string[]>();
  for (const s of subjects) {
    const lvl = LEVELS.get(s.code) ?? 1;
    const arr = byLevel.get(lvl) ?? [];
    arr.push(s.code);
    byLevel.set(lvl, arr);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  // Orden inicial estable: por año y después por nombre.
  const order = new Map<string, number>();
  for (const lvl of levels) {
    const arr = byLevel.get(lvl)!;
    arr.sort((a, b) => {
      const sa = graph.byCode.get(a);
      const sb = graph.byCode.get(b);
      return (sa?.year ?? 0) - (sb?.year ?? 0) || (sa?.name ?? a).localeCompare(sb?.name ?? b);
    });
    arr.forEach((c, i) => order.set(c, i));
  }

  const sweep = (lvlList: number[], neighborsOf: (c: string) => string[]) => {
    for (const lvl of lvlList) {
      const arr = byLevel.get(lvl)!;
      const bary = new Map<string, number>();
      for (const c of arr) {
        const ns = neighborsOf(c).filter((n) => order.has(n));
        bary.set(
          c,
          ns.length ? ns.reduce((acc, n) => acc + order.get(n)!, 0) / ns.length : order.get(c)!,
        );
      }
      arr.sort((a, b) => bary.get(a)! - bary.get(b)! || order.get(a)! - order.get(b)!);
      arr.forEach((c, i) => order.set(c, i));
    }
  };

  for (let it = 0; it < 8; it++) {
    // Hacia adelante: me acerco al promedio de mis correlativas (izquierda).
    sweep(levels.slice(1), (c) => graph.prereqs.get(c) ?? []);
    // Hacia atrás: me acerco al promedio de lo que desbloqueo (derecha).
    sweep([...levels].reverse().slice(1), (c) => graph.dependents.get(c) ?? []);
  }

  const pos = new Map<string, { x: number; y: number }>();
  for (const lvl of levels) {
    byLevel.get(lvl)!.forEach((code, i) => {
      pos.set(code, { x: (lvl - 1) * X_GAP, y: i * Y_GAP });
    });
  }
  return pos;
})();

export function Grafo() {
  const d = useDerived();
  const name = useSubjectName();
  const electiveNames = useStore((s) => s.electiveNames);
  const [colorBy, setColorBy] = useState<'status' | 'track' | 'year'>('status');
  const [selected, setSelected] = useState<string | null>(null);
  /** Pantalla completa: el mapa es grande y se lee mucho mejor. */
  const [expanded, setExpanded] = useState(false);

  // Esc para salir de pantalla completa.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const { related, upstream, downstream } = useMemo(() => {
    if (!selected) return { related: null as Set<string> | null, upstream: new Set<string>(), downstream: new Set<string>() };
    const up = ancestorsOf(graph, selected);
    const down = descendantsOf(graph, selected);
    const rel = new Set<string>([selected, ...up, ...down]);
    return { related: rel, upstream: up, downstream: down };
  }, [selected]);

  const nodes: Node[] = useMemo(() => {
    return subjects.map((s) => {
      const st = d.statuses.get(s.code)!;
      const color =
        colorBy === 'status'
          ? STATUS_COLOR[st]
          : colorBy === 'track'
            ? trackColor(s.track)
            : YEAR_COLORS[s.year - 1] ?? '#94a3b8';
      const dimmed = related ? !related.has(s.code) : false;
      const isSel = selected === s.code;
      return {
        id: s.code,
        position: positions.get(s.code) ?? { x: 0, y: 0 },
        // El layout va izq→der por nivel de correlatividad, así que las flechas
        // salen por la derecha y entran por la izquierda (líneas limpias).
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: s.isElective && electiveNames[s.code] ? electiveNames[s.code] : s.name,
        },
        style: {
          background: color,
          color: '#0b1220',
          border: isSel
            ? '2px solid #0b1220'
            : upstream.has(s.code)
              ? '2px solid #f59e0b'
              : downstream.has(s.code)
                ? '2px solid #22d3ee'
                : '1px solid rgba(0,0,0,0.2)',
          borderRadius: 10,
          // La seleccionada tiene que cantar: más grande, en negrita y con halo.
          fontSize: isSel ? 13 : 11,
          fontWeight: isSel ? 800 : 600,
          width: 190,
          padding: isSel ? 10 : 6,
          opacity: dimmed ? 0.12 : 1,
          boxShadow: isSel
            ? '0 0 0 4px #fff, 0 0 0 8px #3479f6, 0 10px 30px rgba(0,0,0,0.45)'
            : undefined,
          zIndex: isSel ? 10 : undefined,
        },
      } satisfies Node;
    });
  }, [d.statuses, colorBy, related, upstream, downstream, selected, electiveNames]);

  const edges: Edge[] = useMemo(() => {
    const list: Edge[] = [];
    for (const s of subjects) {
      for (const p of graph.prereqs.get(s.code) ?? []) {
        // Aguas arriba (lo que la seleccionada necesita) en ámbar; aguas abajo
        // (lo que desbloquea) en cian — igual que la leyenda y los bordes.
        const isUp = !!related && (upstream.has(p) && (upstream.has(s.code) || s.code === selected));
        const isDown =
          !!related && (downstream.has(s.code) && (downstream.has(p) || p === selected));
        const onPath = isUp || isDown;
        const color = isUp ? '#f59e0b' : isDown ? '#22d3ee' : '#64748b';
        list.push({
          id: `${p}->${s.code}`,
          source: p,
          target: s.code,
          type: 'smoothstep',
          animated: onPath,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
          style: {
            stroke: color,
            strokeWidth: onPath ? 2.5 : 1.2,
            opacity: related ? (onPath ? 1 : 0.05) : 0.28,
          },
          zIndex: onPath ? 5 : 0,
        });
      }
    }
    return list;
  }, [related, upstream, downstream, selected]);

  const selStatus = selected ? d.statuses.get(selected) : null;

  return (
    <div
      className={
        expanded
          ? 'fixed inset-0 z-50 flex flex-col gap-3 overflow-auto bg-slate-50 p-4 dark:bg-slate-950'
          : 'space-y-3'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500 dark:text-slate-400">Colorear por:</span>
          <div className="flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
            <Seg active={colorBy === 'status'} onClick={() => setColorBy('status')}>
              Estado
            </Seg>
            <Seg active={colorBy === 'track'} onClick={() => setColorBy('track')}>
              Trayecto
            </Seg>
            <Seg active={colorBy === 'year'} onClick={() => setColorBy('year')}>
              Año
            </Seg>
          </div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title={expanded ? 'Salir de pantalla completa (Esc)' : 'Ver el mapa en grande'}
          >
            {expanded ? '✕ Salir' : '⛶ Ver en grande'}
          </button>
        </div>
        <Legend colorBy={colorBy} />
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
          <span className="font-semibold">{name(selected)}</span>
          {selStatus && (
            <span className="text-slate-500">{STATUS_LABEL[selStatus]}</span>
          )}
          <span className="text-amber-500">↑ {upstream.size} necesita</span>
          <span className="text-cyan-500">↓ {downstream.size} desbloquea</span>
          <button
            onClick={() => setSelected(null)}
            className="ml-auto text-xs text-slate-400 hover:text-slate-600"
          >
            limpiar selección ✕
          </button>
        </div>
      )}

      <div
        className={`overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 ${
          expanded ? 'min-h-0 flex-1' : 'h-[68vh]'
        }`}
      >
        <ReactFlow
          // Al cambiar de tamaño remontamos para que vuelva a encuadrar solo.
          key={expanded ? 'full' : 'inline'}
          nodes={nodes}
          edges={edges}
          onNodeClick={(_, n) => setSelected((cur) => (cur === n.id ? null : n.id))}
          onPaneClick={() => setSelected(null)}
          fitView
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background color="#94a3b8" gap={24} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => (n.style?.background as string) ?? '#64748b'}
            maskColor="rgba(0,0,0,0.15)"
          />
        </ReactFlow>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Clic en una materia para resaltar su cadena{' '}
        <span className="text-amber-500">aguas arriba (lo que necesita)</span> y{' '}
        <span className="text-cyan-500">aguas abajo (lo que desbloquea)</span>. El
        eje horizontal es el nivel de correlatividad.
      </p>
    </div>
  );
}

function Seg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs font-medium transition ${
        active ? 'bg-brand-600 text-white' : 'text-slate-600 dark:text-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

function Legend({ colorBy }: { colorBy: 'status' | 'track' | 'year' }) {
  const items =
    colorBy === 'status'
      ? (Object.keys(STATUS_LABEL) as SubjectStatus[]).map((k) => ({
          color: STATUS_COLOR[k],
          label: STATUS_LABEL[k],
        }))
      : colorBy === 'year'
        ? [...new Set(subjects.map((s) => s.year))]
            .sort((a, b) => a - b)
            .map((y) => ({ color: YEAR_COLORS[y - 1] ?? '#94a3b8', label: `${y}° año` }))
        : [...new Set(subjects.map((s) => s.track))].map((t) => ({
            color: trackColor(t),
            label: t,
          }));
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1">
          <span
            className="h-3 w-3 rounded-sm"
            style={{ background: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}
