import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { centreOf } from '../engine/battlefield';
import { dist, type Vec } from '../engine/geometry';
import { aliveModels, onBoard, type GameState, type UnitState } from '../engine/state';

export interface Aim {
  from: Vec;
  to: Vec;
  color: string;
  label: string;
}

export interface Ring {
  x: number;
  y: number;
  r: number;
  color: string;
}

export interface BoardProps {
  state: GameState;
  selectedId: string | null;
  /** Proposed positions for the unit being placed or moved. */
  draft: Map<string, Vec> | null;
  draftUnitId: string | null;
  /** Models whose proposed position breaks a rule. */
  badModels: Set<string>;
  rings: Ring[];
  /** Units to outline, e.g. eligible targets (unit id -> colour). */
  highlight: Map<string, string>;
  aim: Aim | null;
  showZones: boolean;
  danger: number[][] | null;
  moveTogether: boolean;
  onDraft: (draft: Map<string, Vec>, done: boolean) => void;
  onBoardClick: (p: Vec) => void;
  onUnitClick: (unitId: string) => void;
  onHover: (unitId: string | null, p: Vec | null) => void;
}

const OWNER_FILL = { player: '#7d4bc4', ai: '#2f6fd1' };
const OWNER_STROKE = { player: '#d2b3ff', ai: '#9cc2ff' };

export function Board(props: BoardProps) {
  const { state, draft, draftUnitId } = props;
  const bf = state.battlefield;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ modelId: string; start: Vec; base: Map<string, Vec>; moved: boolean } | null>(null);
  const [measure, setMeasure] = useState<{ a: Vec; b: Vec } | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const toBoard = (e: { clientX: number; clientY: number }): Vec => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const posOf = (u: UnitState, id: string, x: number, y: number): Vec => (u.id === draftUnitId && draft?.get(id)) || { x, y };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toBoard(e);
    if (e.button === 2) {
      setMeasure({ a: p, b: p });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toBoard(e);
    if (measure && e.buttons & 2) {
      setMeasure({ a: measure.a, b: p });
      return;
    }
    const d = drag.current;
    if (d && draft) {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.05) d.moved = true;
      const next = new Map(d.base);
      const together = props.moveTogether !== e.altKey;
      for (const [id, q] of d.base) {
        if (together || id === d.modelId) next.set(id, { x: q.x + dx, y: q.y + dy });
      }
      props.onDraft(next, false);
      const dragged = next.get(d.modelId)!;
      const original = draftUnit ? aliveModels(draftUnit).find((m) => m.id === d.modelId) : undefined;
      if (original) setTip({ x: e.clientX + 14, y: e.clientY + 14, text: `${dist(original, dragged).toFixed(1)}" in a straight line` });
      return;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (measure) {
      setMeasure(null);
      return;
    }
    const d = drag.current;
    if (d && draft) {
      drag.current = null;
      setTip(null);
      props.onDraft(draft, true);
      return;
    }
    if (e.button === 0) props.onBoardClick(toBoard(e));
  };

  const draftUnit = draftUnitId ? state.units.find((u) => u.id === draftUnitId) : undefined;

  const startModelDrag = (e: ReactPointerEvent, u: UnitState, modelId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (u.id === draftUnitId && draft) {
      drag.current = { modelId, start: toBoard(e), base: new Map(draft), moved: false };
      svgRef.current?.setPointerCapture(e.pointerId);
    }
  };

  const units = state.units.filter((u) => onBoard(u) || (u.id === draftUnitId && draft));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <svg
        ref={svgRef}
        className="board-svg"
        viewBox={`-1 -1 ${bf.width + 2} ${bf.height + 2}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          props.onHover(null, null);
          setTip(null);
        }}
        onContextMenu={(e) => e.preventDefault()}>
        <rect x={0} y={0} width={bf.width} height={bf.height} fill="#1f2a22" stroke="#3a4a3e" strokeWidth={0.1} rx={0.3} />
        {/* 6" grid for reading distances at a glance. */}
        {Array.from({ length: Math.floor(bf.width / 6) - 1 }, (_, i) => (
          <line key={`gx${i}`} x1={(i + 1) * 6} y1={0} x2={(i + 1) * 6} y2={bf.height} stroke="#ffffff0d" strokeWidth={0.05} />
        ))}
        {Array.from({ length: Math.floor(bf.height / 6) }, (_, i) => (
          <line key={`gy${i}`} x1={0} y1={(i + 1) * 6} x2={bf.width} y2={(i + 1) * 6} stroke="#ffffff0d" strokeWidth={0.05} />
        ))}

        {props.showZones ? (
          <>
            <polygon points={bf.deployment.ai.map((p) => `${p.x},${p.y}`).join(' ')} fill="#2f6fd122" stroke="#2f6fd1" strokeWidth={0.08} strokeDasharray="0.4 0.3" />
            <polygon points={bf.deployment.player.map((p) => `${p.x},${p.y}`).join(' ')} fill="#7d4bc422" stroke="#a66bf0" strokeWidth={0.08} strokeDasharray="0.4 0.3" />
          </>
        ) : null}

        {props.danger
          ? props.danger.flatMap((row, yi) =>
              row.map((v, xi) =>
                v > 0 ? <rect key={`d${xi}-${yi}`} x={xi * 2} y={yi * 2} width={2} height={2} fill={`rgba(236,106,126,${Math.min(0.55, 0.12 + v * 0.1)})`} /> : null,
              ),
            )
          : null}

        {bf.terrain.map((t) => {
          const c = centreOf(t.polygon);
          const owner = t.objective !== undefined ? state.objectives[t.objective] : null;
          return (
            <g key={t.id}>
              <polygon
                points={t.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={t.category === 'dense' ? '#5a5a6888' : '#7a643c66'}
                stroke={t.objective !== undefined ? (owner === 'player' ? '#c49bff' : owner === 'ai' ? '#7fb0ff' : '#e9c46a') : '#ffffff22'}
                strokeWidth={t.objective !== undefined ? 0.16 : 0.06}
                strokeDasharray={t.objective !== undefined ? '0.5 0.25' : undefined}
              />
              {t.walls.map((w, i) => (
                <line key={i} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#b9b9c6" strokeWidth={0.3} strokeLinecap="round" />
              ))}
              {t.objective !== undefined ? (
                <g>
                  <circle cx={c.x} cy={c.y} r={0.8} fill={owner === 'player' ? '#7d4bc4' : owner === 'ai' ? '#2f6fd1' : '#e9c46a'} opacity={0.9} />
                  <text x={c.x} y={c.y + 0.35} fontSize={1} textAnchor="middle" fill="#120e18" fontWeight={900}>
                    {t.objective + 1}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}

        {props.rings.map((r, i) => (
          <circle key={`ring${i}`} cx={r.x} cy={r.y} r={r.r} fill="none" stroke={r.color} strokeWidth={0.08} strokeDasharray="0.3 0.2" />
        ))}

        {units.map((u) => {
          const selected = u.id === props.selectedId;
          const hl = props.highlight.get(u.id);
          const done = u.owner === state.active && (u.flags.shot || u.flags.fought || (state.phase === 'movement' && u.flags.move !== null));
          const alive = aliveModels(u);
          const first = alive[0];
          const labelPos = first ? posOf(u, first.id, first.x, first.y) : null;
          return (
            <g
              key={u.id}
              opacity={done && !selected ? 0.6 : 1}
              onPointerDown={(e) => {
                if (e.button === 0 && u.id !== draftUnitId) e.stopPropagation();
              }}
              onPointerUp={(e) => {
                if (e.button !== 0 || drag.current) return;
                if (u.id !== draftUnitId) {
                  e.stopPropagation();
                  props.onUnitClick(u.id);
                }
              }}
              onPointerEnter={(e) => props.onHover(u.id, toBoard(e))}
              onPointerLeave={() => props.onHover(null, null)}
              style={{ cursor: u.id === draftUnitId ? 'grab' : 'pointer' }}>
              {alive.map((m) => {
                const p = posOf(u, m.id, m.x, m.y);
                const moved = u.id === draftUnitId && draft?.get(m.id) && (draft.get(m.id)!.x !== m.x || draft.get(m.id)!.y !== m.y);
                const bad = props.badModels.has(m.id);
                return (
                  <g key={m.id} onPointerDown={(e) => startModelDrag(e, u, m.id)}>
                    {moved && u.status === 'onBoard' ? (
                      <>
                        <circle cx={m.x} cy={m.y} r={m.r} fill="none" stroke="#ffffff44" strokeWidth={0.05} strokeDasharray="0.15 0.1" />
                        <line x1={m.x} y1={m.y} x2={p.x} y2={p.y} stroke="#ffffff44" strokeWidth={0.05} />
                      </>
                    ) : null}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={m.r}
                      fill={OWNER_FILL[u.owner]}
                      stroke={bad ? '#ec6a7e' : selected ? '#ffffff' : hl ?? (u.battleShocked ? '#f2a65a' : OWNER_STROKE[u.owner])}
                      strokeWidth={bad || selected || hl ? 0.14 : 0.06}
                      strokeDasharray={u.battleShocked ? '0.2 0.12' : undefined}
                    />
                    {m.character ? <circle cx={p.x} cy={p.y} r={m.r * 0.45} fill="none" stroke="#e9c46a" strokeWidth={0.08} /> : null}
                    {m.maxW > 1 ? (
                      <text x={p.x} y={p.y + Math.min(0.35, m.r * 0.45)} fontSize={Math.min(1, m.r * 0.9)} textAnchor="middle" fill="#fff" fontWeight={800} pointerEvents="none">
                        {m.w}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {labelPos && first ? (
                <text x={labelPos.x} y={labelPos.y - first.r - 0.3} fontSize={0.75} textAnchor="middle" fill={selected ? '#fff' : '#ddd'} fontWeight={700} pointerEvents="none" style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 0.15 }}>
                  {shortName(u.name)}
                </text>
              ) : null}
            </g>
          );
        })}

        {props.aim ? (
          <g pointerEvents="none">
            <line x1={props.aim.from.x} y1={props.aim.from.y} x2={props.aim.to.x} y2={props.aim.to.y} stroke={props.aim.color} strokeWidth={0.12} strokeDasharray="0.5 0.25" />
            <circle cx={props.aim.to.x} cy={props.aim.to.y} r={0.25} fill={props.aim.color} />
            <text x={(props.aim.from.x + props.aim.to.x) / 2} y={(props.aim.from.y + props.aim.to.y) / 2 - 0.4} fontSize={0.8} fill={props.aim.color} textAnchor="middle" fontWeight={800} style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 0.15 }}>
              {props.aim.label}
            </text>
          </g>
        ) : null}

        {measure ? (
          <g pointerEvents="none">
            <line x1={measure.a.x} y1={measure.a.y} x2={measure.b.x} y2={measure.b.y} stroke="#e9c46a" strokeWidth={0.1} />
            <text x={measure.b.x + 0.5} y={measure.b.y - 0.5} fontSize={1} fill="#e9c46a" fontWeight={800} style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 0.2 }}>
              {dist(measure.a, measure.b).toFixed(1)}"
            </text>
          </g>
        ) : null}
      </svg>
      {tip ? (
        <div className="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      ) : null}
    </div>
  );
}

/** "Intercessor Squad 1 + Marneus Calgar" -> "Intercessors 1 + Calgar" style short labels. */
function shortName(name: string): string {
  return name
    .split(' + ')
    .map((part) => part.replace(/ Squad/, '').replace(/^Tyranid Warriors With /, 'Warriors ').replace(/ Bio-weapons/, ''))
    .join(' + ');
}
