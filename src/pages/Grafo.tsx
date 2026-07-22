import { useMemo, useState } from 'react';
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

const positions = (() => {
  const byLevel = new Map<number, string[]>();
  for (const s of subjects) {
    const lvl = LEVELS.get(s.code) ?? 1;
    const arr = byLevel.get(lvl) ?? [];
    arr.push(s.code);
    byLevel.set(lvl, arr);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [lvl, codes] of byLevel) {
    codes
      .sort((a, b) => a.localeCompare(b))
      .forEach((code, i) => {
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
            ? '3px solid #fff'
            : upstream.has(s.code)
              ? '2px solid #f59e0b'
              : downstream.has(s.code)
                ? '2px solid #22d3ee'
                : '1px solid rgba(0,0,0,0.2)',
          borderRadius: 10,
          fontSize: 11,
          fontWeight: 600,
          width: 190,
          padding: 6,
          opacity: dimmed ? 0.18 : 1,
        },
      } satisfies Node;
    });
  }, [d.statuses, colorBy, related, upstream, downstream, selected, electiveNames]);

  const edges: Edge[] = useMemo(() => {
    const list: Edge[] = [];
    for (const s of subjects) {
      for (const p of graph.prereqs.get(s.code) ?? []) {
        const onPath =
          related && related.has(s.code) && related.has(p) &&
          ((upstream.has(p) && (upstream.has(s.code) || s.code === selected)) ||
            (downstream.has(s.code) && (downstream.has(p) || p === selected)));
        list.push({
          id: `${p}->${s.code}`,
          source: p,
          target: s.code,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: onPath ? '#3479f6' : '#64748b' },
          style: {
            stroke: onPath ? '#3479f6' : '#64748b',
            strokeWidth: onPath ? 2.5 : 1.2,
            opacity: related ? (onPath ? 1 : 0.06) : 0.3,
          },
        });
      }
    }
    return list;
  }, [related, upstream, downstream, selected]);

  const selStatus = selected ? d.statuses.get(selected) : null;

  return (
    <div className="space-y-3">
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

      <div className="h-[68vh] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <ReactFlow
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
