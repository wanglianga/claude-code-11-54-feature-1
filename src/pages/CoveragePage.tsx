import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCircle2, Layers, Radio, ScanSearch, SlidersHorizontal, TimerReset } from 'lucide-react';
import { store, useStore, useActiveMapping } from '../state/store';
import { heatingDayKey, enumerateDayKeys, dayStartTs, dayEndTs, fmtDayLabel } from '../lib/time';
import { Callout, Panel, Stat } from '../components/ui/primitives';
import { PageHead } from '../components/Layout';
import type { AnalysisConfig, DayClass } from '../types';
import { matchBuildingsInText } from '../lib/address';

const CLASS: { key: DayClass; label: string; tone: string; hint: string }[] = [
  { key: 'supply_shortfall', label: '有持续低温', tone: 'high', hint: '读数与工单一致' },
  { key: 'local_equipment', label: '局部低温', tone: 'medium', hint: '仅部分探头偏低' },
  { key: 'transient_disturbance', label: '短时扰动', tone: 'cool', hint: '低于 90 分钟' },
  { key: 'insufficient_coverage', label: '覆盖不足', tone: 'undetermined', hint: '探头缺失或断线' },
  { key: 'normal', label: '覆盖达标', tone: 'low', hint: '无低温事件' },
];

export function CoveragePage() {
  const state = useStore();
  const mapping = useActiveMapping();
  const [cfg, setCfg] = useState<AnalysisConfig>(state.config);

  const computed = useMemo(() => {
    const dayKeys = enumerateDayKeys(cfg.windowStartDay, cfg.windowEndDay);
    const probes = mapping?.probes ?? [];
    const buildings = mapping?.buildings ?? [];
    const readingBatches = state.batches.filter((b) => b.kind === 'readings');
    const weatherBatches = state.batches.filter((b) => b.kind === 'weather');
    const orderBatches = state.batches.filter((b) => b.kind === 'work_orders');
    const complaintBatches = state.batches.filter((b) => b.kind === 'complaints');

    // Per probe: count of readings per heating day in window.
    const perProbeDay = new Map<string, number>();
    const perProbe = new Map<string, { first: number | null; last: number | null; count: number }>();
    for (const batch of readingBatches) {
      for (const r of batch.data.readings ?? []) {
        const day = heatingDayKey(r.ts, cfg.heatingDayStartHour);
        if (!dayKeys.includes(day)) continue;
        const key = `${r.sensorId}@${day}`;
        perProbeDay.set(key, (perProbeDay.get(key) ?? 0) + 1);
        const p = perProbe.get(r.sensorId) ?? { first: null, last: null, count: 0 };
        p.first = p.first === null ? r.ts : Math.min(p.first, r.ts);
        p.last = p.last === null ? r.ts : Math.max(p.last, r.ts);
        p.count += 1;
        perProbe.set(r.sensorId, p);
      }
    }
    const knownSensorIds = new Set(probes.map((p) => p.id));
    const unknownSensors = [...perProbe.keys()].filter((id) => !knownSensorIds.has(id));

    let covered = 0;
    let total = 0;
    const byBuilding = buildings.map((b) => {
      const bProbes = probes.filter((p) => p.buildingId === b.id);
      let bDaysCovered = 0;
      let bDaysTotal = 0;
      for (const dk of dayKeys) {
        const expected = bProbes.reduce((s, p) => {
          const expectedCount = Math.floor((24 * 60) / p.intervalMin) + 1;
          return s + expectedCount;
        }, 0);
        const received = bProbes.reduce((s, p) => s + (perProbeDay.get(`${p.id}@${dk}`) ?? 0), 0);
        const ratio = expected ? received / expected : 0;
        bDaysTotal += 1;
        if (ratio >= cfg.minCoverageRatio && bProbes.length > 0) bDaysCovered += 1;
        covered += ratio >= cfg.minCoverageRatio && bProbes.length > 0 ? 1 : 0;
        total += 1;
      }
      return {
        building: b,
        probes: bProbes,
        daysCovered: bDaysCovered,
        daysTotal: bDaysTotal,
      };
    });

    // Weather coverage by day.
    const weatherByDay = new Map<string, number>();
    for (const batch of weatherBatches) {
      for (const w of batch.data.weather ?? []) {
        const day = heatingDayKey(w.ts, cfg.heatingDayStartHour);
        if (!dayKeys.includes(day)) continue;
        weatherByDay.set(day, (weatherByDay.get(day) ?? 0) + 1);
      }
    }

    // Work orders per day & building resolution.
    let resolvedOrders = 0;
    let unresolvedOrders = 0;
    const unresolvedList: string[] = [];
    const aliases = new Map<string, string>();
    for (const b of buildings) {
      for (const a of [b.name, `${b.complex}${b.name}`, ...b.aliases]) aliases.set(a.replace(/\s/g, ''), b.id);
    }
    const ordersByDay = new Map<string, number>();
    for (const batch of orderBatches) {
      for (const o of batch.data.workOrders ?? []) {
        const day = heatingDayKey(o.startTs, cfg.heatingDayStartHour);
        if (dayKeys.includes(day)) ordersByDay.set(day, (ordersByDay.get(day) ?? 0) + 1);
        const raw = (o.rawBuilding ?? '').replace(/\s/g, '');
        const exact = aliases.get(raw);
        const hits = exact ? [exact] : matchBuildingsInText(raw, buildings);
        if (hits.length === 1) resolvedOrders += 1;
        else {
          unresolvedOrders += 1;
          unresolvedList.push(`${o.id}（${o.rawBuilding || '空楼栋'}）`);
        }
      }
    }

    const complaintCount = complaintBatches.reduce((s, b) => s + (b.data.complaints?.length ?? 0), 0);
    const outOfWindowReadings = readingBatches.reduce(
      (s, b) =>
        s + (b.data.readings ?? []).filter((r) => {
          const d = heatingDayKey(r.ts, cfg.heatingDayStartHour);
          return !dayKeys.includes(d);
        }).length,
      0,
    );
    return {
      dayKeys,
      perProbeDay,
      perProbe,
      unknownSensors,
      byBuilding,
      weatherByDay,
      ordersByDay,
      resolvedOrders,
      unresolvedOrders,
      unresolvedList,
      complaintCount,
      outOfWindowReadings,
      readingsTotal: readingBatches.reduce((s, b) => s + (b.data.readings?.length ?? 0), 0),
      weatherTotal: weatherBatches.reduce((s, b) => s + (b.data.weather?.length ?? 0), 0),
      ordersTotal: orderBatches.reduce((s, b) => s + (b.data.workOrders?.length ?? 0), 0),
    };
  }, [state.batches, mapping, cfg]);

  const noProbeBuildings = computed.byBuilding.filter((b) => b.probes.length === 0);
  const deadProbes = [...computed.perProbe.entries()].filter(([, v]) => v.count === 0);

  return (
    <>
      <PageHead
        title="覆盖对齐"
        lede="先用「楼栋 × 供热日」的覆盖面回答“有没有数据可判断”，再进入分析。探头缺失或断线的楼栋会单独标为盲区，不会被读成没有供热问题。"
        actions={
          <Link className="btn primary" to="/runs">
            <ScanSearch size={14} />
            进入运行
          </Link>
        }
      />

      <div className="grid c4">
        <Stat
          label="楼栋-供热日覆盖达标"
          value={computed.byBuilding.length ? Math.round((computed.byBuilding.reduce((s, b) => s + b.daysCovered, 0) / Math.max(1, computed.byBuilding.length * computed.dayKeys.length)) * 100) : 0}
          unit="%"
          foot={`阈值 ≥ ${Math.round(cfg.minCoverageRatio * 100)}%，按每探头上传间隔推算应到条数`}
          tone="var(--teal)"
          icon={<Layers size={13} color="var(--teal)" />}
        />
        <Stat
          label="无探头楼栋"
          value={noProbeBuildings.length}
          unit={`/ ${computed.byBuilding.length}`}
          foot={noProbeBuildings.length ? noProbeBuildings.map((b) => b.building.name).join('、') : '全部楼栋已安装探头'}
          tone={noProbeBuildings.length ? 'var(--unknown)' : undefined}
          icon={<Radio size={13} color="var(--unknown)" />}
        />
        <Stat
          label="工单楼栋定位"
          value={`${computed.resolvedOrders}/${computed.resolvedOrders + computed.unresolvedOrders}`}
          foot={computed.unresolvedOrders ? `${computed.unresolvedOrders} 条无法定位：${computed.unresolvedList.join('、')}` : '全部工单可定位'}
          tone={computed.unresolvedOrders ? 'var(--medium)' : 'var(--low)'}
          icon={<TimerReset size={13} color="var(--medium)" />}
        />
        <Stat
          label="窗口外读数"
          value={computed.outOfWindowReadings.toLocaleString()}
          foot={`读数合计 ${computed.readingsTotal.toLocaleString()} 条；窗口内 ${(computed.readingsTotal - computed.outOfWindowReadings).toLocaleString()} 条`}
          icon={<CalendarClock size={13} color="var(--cool)" />}
        />
      </div>

      <Panel
        title="对齐参数"
        sub="供热日从当日 06:00 开始；窗口边界对所有来源一致适用。"
        actions={
          <button className="btn sm" onClick={() => setCfg(state.config)}>
            <SlidersHorizontal size={12} />
            重置为当前配置
          </button>
        }
      >
        <div className="grid c4">
          <div className="field">
            <label>分析窗口起（供热日）</label>
            <input type="date" value={cfg.windowStartDay} onChange={(e) => setCfg({ ...cfg, windowStartDay: e.target.value })} />
          </div>
          <div className="field">
            <label>分析窗口止（供热日）</label>
            <input type="date" value={cfg.windowEndDay} onChange={(e) => setCfg({ ...cfg, windowEndDay: e.target.value })} />
          </div>
          <div className="field">
            <label>供热日起点（时）</label>
            <input type="number" min={0} max={23} value={cfg.heatingDayStartHour} onChange={(e) => setCfg({ ...cfg, heatingDayStartHour: Number(e.target.value) })} />
            <span className="hint">夜间停供因此不会被拆到两个供热日。</span>
          </div>
          <div className="field">
            <label>覆盖下限（日 / 夜）</label>
            <div className="row">
              <input type="number" step={0.05} min={0.1} max={1} value={cfg.minCoverageRatio} onChange={(e) => setCfg({ ...cfg, minCoverageRatio: Number(e.target.value) })} />
              <input type="number" step={0.05} min={0.1} max={1} value={cfg.minNightCoverageRatio} onChange={(e) => setCfg({ ...cfg, minNightCoverageRatio: Number(e.target.value) })} />
            </div>
            <span className="hint">低于下限的供热日标记为无法判断。</span>
          </div>
        </div>
        <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
          <button
            className="btn"
            onClick={async () => {
              await store.updateConfig(cfg);
            }}
          >
            保存为当前配置
          </button>
          <span className="tiny-2">已在运行中固定使用的旧配置不会改变。</span>
        </div>
      </Panel>

      <Panel title="楼栋 × 供热日 监测覆盖" sub="色块显示当日有效读数比例；斜纹/无表示无法判断。" pad={false}>
        <div style={{ overflowX: 'auto', padding: '14px 18px' }}>
          <div
            className="matrix"
            style={{ gridTemplateColumns: `160px repeat(${computed.dayKeys.length}, minmax(30px, 1fr))`, minWidth: 160 + computed.dayKeys.length * 32 }}
          >
            <div />
            {computed.dayKeys.map((k) => (
              <div key={k} className="col-label" title={fmtDayLabel(k)}>{k.slice(8)}</div>
            ))}
            {computed.byBuilding.map(({ building, probes: bProbes, daysCovered }) => (
              <BuildingRow
                key={building.id}
                name={building.name}
                probeCount={bProbes.length}
                daysCovered={daysCovered}
                dayKeys={computed.dayKeys}
                perProbeDay={computed.perProbeDay}
                probeIds={bProbes.map((p) => p.id)}
                expectedPerDay={bProbes.reduce((s, p) => s + Math.floor((24 * 60) / p.intervalMin) + 1, 0)}
                minRatio={cfg.minCoverageRatio}
              />
            ))}
          </div>
          <div className="legend" style={{ marginTop: 12 }}>
            <span><i style={{ background: 'rgba(88,193,178,0.75)' }} />覆盖达标</span>
            <span><i style={{ background: 'rgba(224,168,74,0.6)' }} />部分覆盖</span>
            <span><i style={{ background: 'rgba(229,100,92,0.6)' }} />严重不足</span>
            <span><i style={{ background: 'rgba(156,143,208,0.35)' }} />无探头</span>
            <span className="tiny-2">数字为该供热日有效读数比例（%）。</span>
          </div>
        </div>
      </Panel>

      <div className="grid c2">
        <Panel title="来源覆盖摘要">
          <table className="table">
            <thead>
              <tr><th>来源</th><th>数据集</th><th style={{ textAlign: 'right' }}>行数</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr><td>室温读数</td><td>{(mapping?.probes.length ?? 0)} 个登记探头{computed.unknownSensors.length ? ` · ${computed.unknownSensors.length} 个未登记` : ''}</td><td className="num" style={{ textAlign: 'right' }}>{computed.readingsTotal.toLocaleString()}</td><td className="tiny-2">窗口内 {computed.readingsTotal - computed.outOfWindowReadings}</td></tr>
              <tr><td>气象观测</td><td>{computed.weatherByDay.size} 供热日</td><td className="num" style={{ textAlign: 'right' }}>{computed.weatherTotal.toLocaleString()}</td><td className="tiny-2">30 分钟一次，允许 3 小时间隙内插值</td></tr>
              <tr><td>工单</td><td>{computed.ordersByDay.size} 供热日</td><td className="num" style={{ textAlign: 'right' }}>{computed.ordersTotal}</td><td className="tiny-2">{computed.unresolvedOrders ? `${computed.unresolvedOrders} 条楼栋无法定位` : '全部可定位'}</td></tr>
              <tr><td>投诉</td><td>—</td><td className="num" style={{ textAlign: 'right' }}>{computed.complaintCount}</td><td className="tiny-2">地址需人工确认或自动归属</td></tr>
            </tbody>
          </table>
        </Panel>

        <Panel title="对齐问题">
          <div className="stack">
            {computed.unknownSensors.length > 0 && (
              <Callout tone="warn" icon={<AlertTriangle size={15} color="var(--medium)" />}>
                <strong>未登记探头：</strong>{computed.unknownSensors.join('、')} 出现在读数中，但不在登记册里；这些读数不会进入分析。
              </Callout>
            )}
            {noProbeBuildings.length > 0 && (
              <Callout tone="warn" icon={<AlertTriangle size={15} color="var(--unknown)" />}>
                <strong>{noProbeBuildings.length} 栋楼没有室温探头：</strong>{noProbeBuildings.map((b) => b.building.name).join('、')}。这些楼栋在分析结果中会单独标为「监测盲区」，并提示“无投诉不等于无风险”。
              </Callout>
            )}
            {deadProbes.map(([id, v]) => (
              <Callout key={id} tone="warn" icon={<AlertTriangle size={15} color="var(--high)" />}>
                <strong>{id} 在窗口内无任何有效读数。</strong> 它的楼栋可能因此被判为覆盖不足；请确认是探头断线还是楼栋已拆除。
              </Callout>
            ))}
            {computed.unresolvedOrders > 0 && (
              <Callout tone="warn" icon={<AlertTriangle size={15} color="var(--medium)" />}>
                <strong>{computed.unresolvedOrders} 条工单的楼栋无法在登记册中定位：</strong> {computed.unresolvedList.join('、')}。它们不会参与楼栋级证据，但会出现在「对齐问题」中。
              </Callout>
            )}
            {!computed.unknownSensors.length && !noProbeBuildings.length && !deadProbes.length && !computed.unresolvedOrders && (
              <div className="row" style={{ gap: 8 }}>
                <CheckCircle2 size={16} color="var(--low)" />
                <span className="tiny">未发现来源之间的对齐问题。</span>
              </div>
            )}
            <div className="callout info">
              探头断线不一定是设备故障，也可能是住户拔电或夏季拆除；工具只报告“覆盖率低”，并把归因留给分析员。
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

function BuildingRow({
  name,
  probeCount,
  daysCovered,
  dayKeys,
  perProbeDay,
  probeIds,
  expectedPerDay,
  minRatio,
}: {
  name: string;
  probeCount: number;
  daysCovered: number;
  dayKeys: string[];
  perProbeDay: Map<string, number>;
  probeIds: string[];
  expectedPerDay: number;
  minRatio: number;
}) {
  return (
    <>
      <div className="row-label">
        <span style={{ fontWeight: 600 }}>{name}</span>
        {probeCount === 0 ? (
          <span className="tiny-2" style={{ color: 'var(--unknown)' }}>无探头</span>
        ) : (
          <span className="tiny-2">{daysCovered}/{dayKeys.length} 天</span>
        )}
      </div>
      {dayKeys.map((k) => {
        if (probeCount === 0) {
          return (
            <div
              key={k}
              className="cell"
              style={{ background: 'rgba(156,143,208,0.26)', color: 'transparent' }}
              title={`${name} ${k} · 无室温探头`}
            />
          );
        }
        const received = probeIds.reduce((s, id) => s + (perProbeDay.get(`${id}@${k}`) ?? 0), 0);
        const ratio = expectedPerDay ? Math.min(1, received / expectedPerDay) : 0;
        const background =
          ratio >= minRatio
            ? `rgba(88,193,178,${0.25 + ratio * 0.55})`
            : ratio >= minRatio * 0.5
              ? `rgba(224,168,74,${0.2 + ratio * 0.6})`
              : `rgba(229,100,92,${0.16 + ratio * 0.6})`;
        return (
          <div
            key={k}
            className="cell"
            style={{ background, color: 'rgba(0,0,0,0.6)', fontWeight: 700 }}
            title={`${name} ${fmtDayLabel(k)} · 有效 ${received}/${expectedPerDay} 条（${(ratio * 100).toFixed(0)}%）`}
          >
            {Math.round(ratio * 100)}
          </div>
        );
      })}
    </>
  );
}
