import { useMemo, useState } from 'react';
import type { BuildingDayResult, BuildingSummary, DayClass, HourPoint } from '../../types';
import { DAY_CLASS_META, RISK_META } from '../../lib/format';
import { fmtLocal } from '../../lib/time';

/* ------------------------------------------------------------------ */
/* Building × heating-day heat matrix                                  */
/* ------------------------------------------------------------------ */

export function CoverageMatrix({
  days,
  summaries,
  onCell,
  onRow,
  metric = 'class',
}: {
  days: BuildingDayResult[];
  summaries: BuildingSummary[];
  onCell?: (day: BuildingDayResult) => void;
  onRow?: (buildingId: string) => void;
  metric?: 'class' | 'coverage';
}) {
  const dayKeys = useMemo(() => {
    const set = new Set(days.map((d) => d.dayKey));
    return [...set].sort();
  }, [days]);
  const byKey = useMemo(() => {
    const map = new Map<string, BuildingDayResult>();
    for (const d of days) map.set(`${d.buildingId}@${d.dayKey}`, d);
    return map;
  }, [days]);
  const [hover, setHover] = useState<{ d: BuildingDayResult; x: number; y: number } | null>(null);

  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <div
        className="matrix"
        style={{ gridTemplateColumns: `150px repeat(${dayKeys.length}, minmax(28px, 1fr))`, minWidth: 150 + dayKeys.length * 30 }}
      >
        <div />
        {dayKeys.map((k) => (
          <div key={k} className="col-label" title={k}>
            {k.slice(8)}
          </div>
        ))}
        {summaries.map((s) => (
          <FragmentRow
            key={s.buildingId}
            summary={s}
            dayKeys={dayKeys}
            byKey={byKey}
            onRow={onRow}
            onCell={onCell}
            metric={metric}
            onHover={(d, x, y) => setHover(d ? { d, x, y } : null)}
          />
        ))}
      </div>
      {hover && (
        <div
          style={{
            position: 'fixed',
            left: hover.x + 12,
            top: hover.y + 12,
            zIndex: 40,
            pointerEvents: 'none',
            background: '#101b22',
            border: '1px solid var(--line)',
            borderRadius: 9,
            padding: '9px 11px',
            fontSize: 11,
            boxShadow: 'var(--shadow)',
            maxWidth: 280,
          }}
        >
          <div style={{ fontWeight: 650, marginBottom: 3 }}>
            {hover.d.buildingName} · {hover.d.dayKey}
          </div>
          <div style={{ color: DAY_CLASS_META[hover.d.classification].text }}>
            {DAY_CLASS_META[hover.d.classification].label}
          </div>
          <div className="tiny muted" style={{ marginTop: 3 }}>
            覆盖 {(hover.d.coverage.coverageRatio * 100).toFixed(0)}% · 夜间 {(hover.d.coverage.nightCoverageRatio * 100).toFixed(0)}%
            {hover.d.episodes.length ? ` · ${hover.d.episodes.length} 个低温片段` : ''}
          </div>
          {hover.d.coverage.hasNoProbe && <div className="tiny" style={{ color: 'var(--unknown)' }}>未装探头</div>}
        </div>
      )}
    </div>
  );
}

function FragmentRow({
  summary,
  dayKeys,
  byKey,
  onCell,
  onRow,
  metric,
  onHover,
}: {
  summary: BuildingSummary;
  dayKeys: string[];
  byKey: Map<string, BuildingDayResult>;
  onCell?: (d: BuildingDayResult) => void;
  onRow?: (buildingId: string) => void;
  metric: 'class' | 'coverage';
  onHover: (d: BuildingDayResult | null, x: number, y: number) => void;
}) {
  return (
    <>
      <div className="row-label" style={{ cursor: onRow ? 'pointer' : 'default' }} onClick={() => onRow?.(summary.buildingId)}>
        <span style={{ fontWeight: 600 }}>{summary.name}</span>
        {summary.probeCount === 0 ? (
          <span className="tiny-2" style={{ color: 'var(--unknown)' }}>无探头</span>
        ) : (
          <span className="tiny-2">{summary.probeCount} 探头</span>
        )}
      </div>
      {dayKeys.map((k) => {
        const d = byKey.get(`${summary.buildingId}@${k}`);
        if (!d) return <div key={k} className="cell blank" />;
        const meta = DAY_CLASS_META[d.classification];
        if (metric === 'coverage') {
          const r = d.coverage.coverageRatio;
          return (
            <div
              key={k}
              className="cell"
              style={{
                background: `rgba(88, 193, 178, ${0.08 + r * 0.6})`,
                color: r < 0.4 ? '#ffb3ad' : 'rgba(0,0,0,0.65)',
                cursor: onCell ? 'pointer' : 'default',
              }}
              onClick={() => onCell?.(d)}
              onMouseMove={(e) => onHover(d, e.clientX, e.clientY)}
              onMouseLeave={() => onHover(null, 0, 0)}
            >
              {Math.round(r * 100)}
            </div>
          );
        }
        return (
          <div
            key={k}
            className="cell"
            style={{ background: meta.color, color: meta.text, cursor: onCell ? 'pointer' : 'default' }}
            onClick={() => onCell?.(d)}
            onMouseMove={(e) => onHover(d, e.clientX, e.clientY)}
            onMouseLeave={() => onHover(null, 0, 0)}
            title={`${d.buildingName} ${d.dayKey} · ${meta.label}`}
          >
            {d.coverage.hasNoProbe ? '无' : d.classification === 'normal' ? '·' : meta.short}
          </div>
        );
      })}
    </>
  );
}

export function ClassLegend() {
  const order: DayClass[] = [
    'supply_shortfall',
    'local_equipment',
    'transient_disturbance',
    'unreliable_alignment',
    'insufficient_coverage',
    'normal',
  ];
  return (
    <div className="legend">
      {order.map((c) => (
        <span key={c}>
          <i style={{ background: DAY_CLASS_META[c].color }} />
          {DAY_CLASS_META[c].label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 24-hour day chart: indoor band + outdoor temp + work orders         */
/* ------------------------------------------------------------------ */

export function DayChart({
  day,
  threshold,
  severe,
  height = 190,
  startHour = 6,
  orders = [],
}: {
  day: BuildingDayResult;
  threshold: number;
  severe: number;
  height?: number;
  startHour?: number;
  orders?: { id: string; kind: string; startTs: number; endTs: number; summary: string }[];
}) {
  const width = 760;
  const padL = 44;
  const padR = 52;
  const padT = 12;
  const padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const start = day.dayStartTs;
  const end = day.dayEndTs;
  const indoor = day.hourly.map((h) => h.indoorC).filter((v): v is number => v !== null);
  const outdoor = day.hourly.map((h) => h.outdoorC).filter((v): v is number => v !== null);
  const indoorMin = indoor.length ? Math.min(...indoor, threshold, severe) - 1.5 : 10;
  const indoorMax = indoor.length ? Math.max(...indoor, threshold) + 1.5 : 24;
  const outMin = outdoor.length ? Math.min(...outdoor) - 1 : -20;
  const outMax = outdoor.length ? Math.max(...outdoor) + 1 : 0;
  const x = (ts: number) => padL + ((ts - start) / (end - start)) * plotW;
  const yIn = (v: number) => padT + plotH - ((v - indoorMin) / (indoorMax - indoorMin)) * plotH;
  const yOut = (v: number) => padT + plotH - ((v - outMin) / (outMax - outMin)) * plotH;

  const nightBand = (() => {
    // 22:00 → 06:00 across the heating day.
    const a = start + (((22 - startHour) + 24) % 24) * 3_600_000;
    const b = start + (((6 - startHour) + 24) % 24 || 24) * 3_600_000;
    return b > a ? { a, b } : { a: start, b: start };
  })();

  // Build indoor polyline of available hours.
  const segments: { ts: number; v: number }[][] = [];
  let current: { ts: number; v: number }[] = [];
  for (const h of day.hourly) {
    if (h.indoorC === null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ ts: h.ts + 30 * 60_000, v: h.indoorC });
    }
  }
  if (current.length) segments.push(current);

  const outPath = day.hourly
    .filter((h) => h.outdoorC !== null)
    .map((h, i) => `${i === 0 ? 'M' : 'L'}${x(h.ts + 30 * 60_000).toFixed(1)},${yOut(h.outdoorC!).toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', width: '100%', height: 'auto', minHeight: height * 0.55 }}>
      <rect x={x(nightBand.a)} y={padT} width={x(nightBand.b) - x(nightBand.a)} height={plotH} fill="rgba(106,169,233,0.07)" />
      {[0, 6, 12, 18, 24].map((h) => {
        const ts = start + h * 3_600_000;
        const clock = (startHour + h) % 24;
        return (
          <g key={h}>
            <line x1={x(ts)} x2={x(ts)} y1={padT} y2={padT + plotH} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 4" />
            <text
              x={x(ts)}
              y={height - 10}
              fill="var(--ink-4)"
              fontSize={9.5}
              textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}
              fontFamily="var(--mono)"
            >
              {String(clock).padStart(2, '0')}:00
            </text>
          </g>
        );
      })}
      {/* comfort threshold */}
      <line x1={padL} x2={padL + plotW} y1={yIn(threshold)} y2={yIn(threshold)} stroke="rgba(111,191,143,0.55)" strokeDasharray="4 3" />
      <text x={padL - 6} y={yIn(threshold) + 3} fill="#9ed9b8" fontSize={9} textAnchor="end" fontFamily="var(--mono)">
        {threshold}℃
      </text>
      <line x1={padL} x2={padL + plotW} y1={yIn(severe)} y2={yIn(severe)} stroke="rgba(229,100,92,0.45)" strokeDasharray="3 4" />
      <text x={padL - 6} y={yIn(severe) + 3} fill="#ff9d96" fontSize={9} textAnchor="end" fontFamily="var(--mono)">
        {severe}℃
      </text>

      {/* episodes as bands */}
      {day.episodes.map((ep) => (
        <rect
          key={ep.id}
          x={x(ep.startTs)}
          y={padT}
          width={Math.max(2, x(ep.endTs) - x(ep.startTs))}
          height={plotH}
          fill={
            ep.kind === 'supply_shortfall'
              ? 'rgba(229,100,92,0.14)'
              : ep.kind === 'local_equipment'
                ? 'rgba(224,168,74,0.13)'
                : 'rgba(106,169,233,0.12)'
          }
        />
      ))}

      {/* work order bands at the top of the plot */}
      {orders.map((o) => {
        const a = Math.max(o.startTs, start);
        const b = Math.min(o.endTs, end);
        if (b <= a) return null;
        const tone = o.kind === 'supply_suspension' ? 'rgba(229,100,92,0.85)' : o.kind === 'valve_adjustment' ? 'rgba(224,168,74,0.8)' : 'rgba(156,143,208,0.7)';
        return (
          <g key={o.id}>
            <rect x={x(a)} y={padT} width={Math.max(2, x(b) - x(a))} height={3.5} rx={1.5} fill={tone} />
            <title>{`${o.id} · ${o.summary}`}</title>
          </g>
        );
      })}

      {/* outdoor temp */}
      {outPath && <path d={outPath} fill="none" stroke="rgba(106,169,233,0.6)" strokeWidth={1.2} />}

      {/* indoor segments */}
      {segments.map((seg, i) => (
        <path
          key={i}
          d={seg.map((p, j) => `${j === 0 ? 'M' : 'L'}${x(p.ts).toFixed(1)},${yIn(p.v).toFixed(1)}`).join(' ')}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2.1}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {segments.length === 0 && (
        <text x={padL + plotW / 2} y={padT + plotH / 2} fill="var(--ink-4)" fontSize={11} textAnchor="middle">
          当日无可用室温读数
        </text>
      )}

      <text x={width - padR + 8} y={padT + 9} fill="var(--accent)" fontSize={9.5} fontFamily="var(--mono)">
        室内 ℃
      </text>
      <text x={width - padR + 8} y={padT + 23} fill="var(--cool)" fontSize={9.5} fontFamily="var(--mono)">
        室外 ℃
      </text>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Window ribbon: complaint window vs monitoring coverage              */
/* ------------------------------------------------------------------ */

export function WindowRibbon({
  dayKeys,
  days,
  windowStart,
  windowEnd,
  buildingIds,
  threshold,
}: {
  dayKeys: string[];
  days: BuildingDayResult[];
  windowStart: number;
  windowEnd: number;
  buildingIds: string[];
  threshold: number;
}) {
  const rows = buildingIds.map((id) => days.filter((d) => d.buildingId === id));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {buildingIds.map((bid, idx) => {
        const d = rows[idx];
        const idd = d[0]?.buildingName ?? bid;
        return (
          <div key={bid}>
            <div className="row" style={{ marginBottom: 4 }}>
              <span className="tiny" style={{ fontWeight: 600 }}>{idd}</span>
              <span className="tiny-2">{d.map((x) => x.dayKey).join(' · ')}</span>
            </div>
            <div className="timeline-track">
              {d.map((bd) => {
                const start = Math.max(bd.dayStartTs, windowStart);
                const end = Math.min(bd.dayEndTs, windowEnd);
                if (end <= start) return null;
                const left = ((start - windowStart) / (windowEnd - windowStart)) * 100;
                const w = ((end - start) / (windowEnd - windowStart)) * 100;
                const hasEpisode = bd.episodes.length > 0;
                return (
                  <div
                    key={bd.dayKey}
                    className="timeline-band"
                    style={{
                      left: `${left}%`,
                      width: `${w}%`,
                      background: bd.coverage.hasNoProbe
                        ? 'repeating-linear-gradient(45deg, rgba(156,143,208,0.25) 0 6px, transparent 6px 12px)'
                        : hasEpisode
                          ? 'rgba(229,100,92,0.55)'
                          : bd.coverage.coverageRatio < 0.6
                            ? 'repeating-linear-gradient(45deg, rgba(156,143,208,0.35) 0 5px, rgba(156,143,208,0.08) 5px 11px)'
                            : 'rgba(111,191,143,0.35)',
                    }}
                    title={`${bd.dayKey} · ${DAY_CLASS_META[bd.classification].label} · 覆盖 ${(bd.coverage.coverageRatio * 100).toFixed(0)}%`}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="legend">
        <span><i style={{ background: 'rgba(229,100,92,0.55)' }} />有低温片段</span>
        <span><i style={{ background: 'rgba(111,191,143,0.35)' }} />覆盖达标、无低温</span>
        <span><i style={{ background: 'repeating-linear-gradient(45deg, rgba(156,143,208,0.5) 0 4px, transparent 4px 8px)' }} />探头缺失 / 覆盖不足</span>
        <span><i style={{ background: 'rgba(106,169,233,0.2)' }} />夜间 22:00–06:00</span>
        <span className="tiny-2">{`阈值 ${threshold}℃`}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Simple bar sparkline for risk scores                               */
/* ------------------------------------------------------------------ */

export function MiniBars({ values, max }: { values: number[]; max: number }) {
  return (
    <div className="row" style={{ gap: 2, alignItems: 'flex-end', height: 22 }}>
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: `${Math.max(6, (v / Math.max(1, max)) * 100)}%`,
            borderRadius: 1,
            background: v > 0.66 ? 'var(--high)' : v > 0.33 ? 'var(--medium)' : 'var(--teal)',
            opacity: 0.9,
          }}
        />
      ))}
    </div>
  );
}

export function RiskBadge({ risk }: { risk: keyof typeof RISK_META }) {
  const meta = RISK_META[risk];
  return <span className={`chip ${meta.tone}`}>{meta.label}</span>;
}

export function HourStrip({ hourly, threshold }: { hourly: HourPoint[]; threshold: number }) {
  return (
    <div className="row" style={{ gap: 1.5 }}>
      {hourly.map((h, i) => {
        const v = h.indoorC;
        const tone =
          v === null
            ? 'rgba(255,255,255,0.07)'
            : v < threshold - 2
              ? 'var(--high)'
              : v < threshold
                ? 'var(--medium)'
                : 'var(--teal)';
        return (
          <div
            key={i}
            title={v === null ? `${fmtLocal(h.ts)} 无读数` : `${fmtLocal(h.ts)} · ${v}℃`}
            style={{ flex: 1, height: 14, borderRadius: 2, background: tone, opacity: v === null ? 1 : 0.85 }}
          />
        );
      })}
    </div>
  );
}
