import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  PlayCircle,
  Trash2,
  History,
} from 'lucide-react';
import { store, useStore } from '../state/store';
import type { AnalysisConfig } from '../types';
import { Callout, Chip, Empty, Panel } from '../components/ui/primitives';
import { PageHead } from '../components/Layout';
import { dateTime, fmtHash, RISK_META } from '../lib/format';
import { fmtLocalFull } from '../lib/time';

/** datetime-local input value in the analysis timezone (UTC+8), not the browser's. */
function toLocalInput(ts: number): string {
  return new Date(ts + 8 * 3_600_000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): number {
  return Date.parse(`${value}:00+08:00`);
}

export function RunsPage() {
  const state = useStore();
  const navigate = useNavigate();
  const [label, setLabel] = useState('');
  const [cfg, setCfg] = useState<AnalysisConfig>(state.config);
  const [showCfg, setShowCfg] = useState(false);

  const latest = state.runs[0];
  const comparison = state.comparison;
  const batchesAtCutoff = useMemo(() => {
    const cutoff = state.cutoffMode === 'custom' && state.customCutoffTs ? state.customCutoffTs : Date.now();
    return state.batches.filter((b) => b.ingestedAt <= cutoff);
  }, [state.batches, state.cutoffMode, state.customCutoffTs]);
  const excluded = state.batches.length - batchesAtCutoff.length;

  const ready = state.batches.some((b) => b.kind === 'readings') && !!state.mappings.at(-1)?.buildings.length;
  // Batches whose manifest delivery time is already in the past; re-timestamping them
  // to "now" simulates the backfill arriving after a run started.
  const lateCandidateBatches = useMemo(
    () => state.batches.filter((b) => b.fileName.includes('late')),
    [state.batches],
  );

  async function run() {
    // Any parameter edited here must be persisted before the run so the snapshot captures it.
    if (JSON.stringify(cfg) !== JSON.stringify(state.config)) {
      await store.updateConfig(cfg);
    }
    const result = await store.startRun(label || undefined);
    if (result) navigate('/results');
  }

  return (
    <>
      <PageHead
        title="分析运行"
        lede="一次运行 = 固定的输入快照 + 固定的规则 + 固定的数据截止时点。运行后到达的补录与迟到数据不会局部刷新结果，而是提示新建运行。"
        actions={
          <button className="btn" onClick={() => setShowCfg(!showCfg)}>
            <Clock size={14} />
            {showCfg ? '收起规则参数' : '调整规则参数'}
          </button>
        }
      />

      <div className="grid c2" style={{ alignItems: 'start' }}>
        <Panel title="启动条件" sub="运行前请确认输入批次、数据截止时点与登记册版本。">
          <div className="stack">
            <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <CheckCircle2 size={16} color={ready ? 'var(--low)' : 'var(--medium)'} style={{ marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 560 }}>
                  {state.mappings.at(-1)?.buildings.length ?? 0} 栋楼 · {state.mappings.at(-1)?.probes.length ?? 0} 探头 · v{state.mappings.at(-1)?.version ?? '—'}
                </div>
                <div className="tiny-2">
                  {state.batches.filter((b) => b.kind === 'readings').length} 个读数批次、{state.batches.filter((b) => b.kind === 'weather').length} 个气象、{state.batches.filter((b) => b.kind === 'work_orders').length} 个工单、{state.batches.filter((b) => b.kind === 'complaints').length} 个投诉
                </div>
              </div>
              <Link to="/sources" className="btn sm">导入</Link>
            </div>

            <div className="field">
              <label>数据截止时点</label>
              <div className="row" style={{ gap: 6 }}>
                <button
                  className={`btn sm ${state.cutoffMode === 'now' ? 'primary' : ''}`}
                  onClick={() => store.setCutoff('now', null)}
                >
                  当前时间
                </button>
                <button
                  className={`btn sm ${state.cutoffMode === 'custom' ? 'primary' : ''}`}
                  onClick={() =>
                    store.setCutoff(
                      'custom',
                      state.customCutoffTs ?? Date.parse('2026-01-20T00:00:00+08:00'),
                    )
                  }
                >
                  指定时刻
                </button>
              </div>
              {state.cutoffMode === 'custom' && (
                <>
                  <input
                    type="datetime-local"
                    value={toLocalInput(state.customCutoffTs ?? Date.parse('2026-01-20T00:00:00+08:00'))}
                    onChange={(e) => store.setCutoff('custom', fromLocalInput(e.target.value))}
                    style={{ marginTop: 6 }}
                  />
                  <span className="hint">
                    按本地时间（UTC+8）填写；实际截止 = {fmtLocalFull(state.customCutoffTs ?? Date.parse('2026-01-20T00:00:00+08:00'))}。
                  </span>
                </>
              )}
              <span className="hint">
                只有到达时间 ≤ 截止时点的批次参与本次运行。{excluded > 0 ? `当前有 ${excluded} 个批次会被排除。` : '当前全部批次都在截止内。'}
              </span>
            </div>

            <div className="field">
              <label>运行标签（可选）</label>
              <input type="text" placeholder="例如：1 月第 3 周例行核查" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>

            <div className="row">
              <span className="tiny-2">
                {batchesAtCutoff.length} 个批次将在本运行中冻结为只读快照。
              </span>
              <div className="spacer" />
              <button className="btn primary lg" onClick={run} disabled={!ready || !!state.busy}>
                <PlayCircle size={15} />
                启动分析
              </button>
            </div>
            {lateCandidateBatches.length > 0 && (
              <div className="row" style={{ gap: 8 }}>
                <span className="tiny-2">
                  演示迟到场景：把这 {lateCandidateBatches.length} 个带「late」的批次改为「现在到达」，可验证结果页的覆盖截止提示。
                </span>
                <div className="spacer" />
                <button
                  className="btn sm"
                  onClick={() => store.importSampleSubset(lateCandidateBatches.map((b) => b.id))}
                  disabled={!!state.busy}
                >
                  模拟迟到到达
                </button>
              </div>
            )}
            {!ready && (
              <Callout tone="warn" icon={<AlertTriangle size={15} color="var(--medium)" />}>
                至少需要一份室温读数批次和一份含楼栋的登记册。请先在「来源登记」导入样例数据。
              </Callout>
            )}
          </div>
        </Panel>

        <Panel
          title="运行差异（最近两次）"
          sub={`对比基准：${state.runs.find((r) => r.id === comparison?.baselineRunId)?.label ?? '—'}；变化来自登记册修订、地址确认、规则参数或新数据。`}
          actions={
            comparison && (comparison.affectedComplaints.length + comparison.buildingDeltas.length > 0 || comparison.configChanged) ? (
              <Link to="/results?diff=1" className="btn sm">
                在结果中查看 <ArrowRight size={12} />
              </Link>
            ) : null
          }
        >
          {!latest ? (
            <Empty title="还没有运行">运行完成后，这里会显示两次运行之间的风险与投诉归属变化。</Empty>
          ) : !comparison ? (
            <div className="tiny muted">这是第一次运行。再运行一次即可比较风险与投诉归属变化。</div>
          ) : (
            <div className="stack">
              <div className="row wrap" style={{ gap: 6 }}>
                <Chip tone={comparison.mappingChanged ? 'medium' : 'muted'}>
                  {comparison.mappingChanged ? '登记册或地址判断有变化' : '登记册未变化'}
                </Chip>
                {comparison.configChanged && (
                  <Chip tone="medium">规则参数有变化（{comparison.configDiffs.length} 项）</Chip>
                )}
                <Chip tone={comparison.affectedComplaints.length ? 'medium' : 'low'}>
                  {comparison.affectedComplaints.length} 条投诉归属/结论变化
                </Chip>
                <Chip tone={comparison.buildingDeltas.length ? 'medium' : 'low'}>
                  {comparison.buildingDeltas.length} 栋楼风险变化
                </Chip>
              </div>
              {comparison.configDiffs.length > 0 && (
                <div>
                  <div className="tiny-2" style={{ marginBottom: 4 }}>规则参数差异</div>
                  <div className="stack" style={{ gap: 4 }}>
                    {comparison.configDiffs.map((d) => (
                      <div key={d.key} className="row tiny" style={{ gap: 6 }}>
                        <span>{d.label}</span>
                        <div className="spacer" />
                        <span className="mono tiny-2">{d.from}</span>
                        <ArrowRight size={10} />
                        <span className="mono tiny-2">{d.to}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {comparison.affectedComplaints.length > 0 && (
                <div>
                  <div className="tiny-2" style={{ marginBottom: 4 }}>受影响投诉</div>
                  <div className="stack" style={{ gap: 5 }}>
                    {comparison.affectedComplaints.slice(0, 5).map((c) => (
                      <div key={c.complaintId} className="row tiny" style={{ gap: 6 }}>
                        <span className="mono">{c.complaintId}</span>
                        <span className="muted">{c.rawAddress}</span>
                        <span className="spacer" />
                        <span className="mono tiny-2">{c.oldBuildingIds.join('+') || '未归属'}</span>
                        <ArrowRight size={10} />
                        <span className="mono tiny-2">{c.newBuildingIds.join('+') || '未归属'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {comparison.buildingDeltas.length > 0 && (
                <div>
                  <div className="tiny-2" style={{ marginBottom: 4 }}>楼栋风险变化</div>
                  <div className="stack" style={{ gap: 5 }}>
                    {comparison.buildingDeltas.slice(0, 5).map((d) => (
                      <div key={d.buildingId} className="row tiny" style={{ gap: 6 }}>
                        <span className="mono">{d.buildingId}</span>
                        <span>{d.name}</span>
                        <span className="spacer" />
                        <Chip tone={RISK_META[d.oldRisk].tone}>{RISK_META[d.oldRisk].label}</Chip>
                        <ArrowRight size={10} />
                        <Chip tone={RISK_META[d.newRisk].tone}>{RISK_META[d.newRisk].label}</Chip>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>

      {showCfg && (
        <Panel title="规则参数" sub="修改后保存；已存在的运行快照仍引用当时的规则。">
          <div className="grid c4">
            <div className="field"><label>舒适阈值 ℃</label><input type="number" value={cfg.comfortThresholdC} onChange={(e) => setCfg({ ...cfg, comfortThresholdC: Number(e.target.value) })} /></div>
            <div className="field"><label>严重偏低 ℃</label><input type="number" value={cfg.severeThresholdC} onChange={(e) => setCfg({ ...cfg, severeThresholdC: Number(e.target.value) })} /></div>
            <div className="field"><label>相对自身基线下降 ℃</label><input type="number" value={cfg.deficitDeltaC} onChange={(e) => setCfg({ ...cfg, deficitDeltaC: Number(e.target.value) })} /></div>
            <div className="field"><label>持续不足阈值（小时）</label><input type="number" value={cfg.sustainedMinHours} onChange={(e) => setCfg({ ...cfg, sustainedMinHours: Number(e.target.value) })} /></div>
            <div className="field"><label>短时扰动上限（分钟）</label><input type="number" value={cfg.windowOpeningMaxMinutes} onChange={(e) => setCfg({ ...cfg, windowOpeningMaxMinutes: Number(e.target.value) })} /></div>
            <div className="field"><label>夜间起点 / 终点（时）</label><div className="row"><input type="number" value={cfg.nightStartHour} onChange={(e) => setCfg({ ...cfg, nightStartHour: Number(e.target.value) })} /><input type="number" value={cfg.nightEndHour} onChange={(e) => setCfg({ ...cfg, nightEndHour: Number(e.target.value) })} /></div></div>
            <div className="field"><label>投诉时段前后扩展（分钟）</label><input type="number" value={cfg.complaintPaddingMin} onChange={(e) => setCfg({ ...cfg, complaintPaddingMin: Number(e.target.value) })} /></div>
            <div className="field"><label>地址匹配下限</label><input type="number" step={0.05} min={0.5} max={1} value={cfg.complaintMatchMinScore} onChange={(e) => setCfg({ ...cfg, complaintMatchMinScore: Number(e.target.value) })} /></div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <span className="tiny-2">分析窗口（供热日）</span>
            <input type="date" value={cfg.windowStartDay} onChange={(e) => setCfg({ ...cfg, windowStartDay: e.target.value })} style={{ width: 150 }} />
            <ArrowRight size={12} />
            <input type="date" value={cfg.windowEndDay} onChange={(e) => setCfg({ ...cfg, windowEndDay: e.target.value })} style={{ width: 150 }} />
            <div className="spacer" />
            <button className="btn" onClick={() => store.updateConfig(cfg)}>保存参数</button>
          </div>
        </Panel>
      )}

      <Panel title="运行历史" sub="每次运行都能回查输入、规则、登记册与地址判断；点击进入结果。" pad={false}>
        {state.runs.length === 0 ? (
          <Empty icon={<History size={24} />} title="尚无运行记录">点击「启动分析」生成第一个运行快照。</Empty>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>运行</th>
                  <th>规则版本</th>
                  <th>登记册</th>
                  <th>截止时点</th>
                  <th style={{ textAlign: 'right' }}>高风险</th>
                  <th style={{ textAlign: 'right' }}>投诉</th>
                  <th>输入批次</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.runs.map((r, idx) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/results?run=${r.id}`)}>
                    <td>
                      <div style={{ fontWeight: 560 }}>{r.label}</div>
                      <div className="tiny-2">{dateTime(r.createdAt)} {idx === 0 && <Chip tone="teal" >最新</Chip>}</div>
                    </td>
                    <td className="mono tiny-2">{r.engineVersion}</td>
                    <td className="tiny">
                      <div>{state.mappings.find((m) => m.id === r.mappingVersionId)?.version ? `v${state.mappings.find((m) => m.id === r.mappingVersionId)!.version}` : 'v快照'}</div>
                      <div className="tiny-2 mono">{fmtHash(r.mappingDigest, 8)}</div>
                    </td>
                    <td className="tiny">{dateTime(r.dataCutoffTs)}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{r.result.totals.highRiskBuildings}</td>
                    <td className="num" style={{ textAlign: 'right' }}>
                      {r.result.totals.complaints}
                      <div className="tiny-2">{r.result.totals.supportedComplaints} 支持</div>
                    </td>
                    <td className="tiny-2">{r.inputRefs.length} 个</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <Link to={`/reports?run=${r.id}`} className="btn ghost sm">报告</Link>
                        <button className="btn ghost sm" onClick={() => store.deleteRun(r.id)} title="删除运行">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {latest && (
        <Panel title="最新运行的输入快照" sub={`${latest.inputRefs.length} 个批次 · 截止 ${dateTime(latest.dataCutoffTs)}`}>
          <div className="grid c2">
            {latest.inputRefs.map((ref) => (
              <div key={ref.batchId} className="row" style={{ gap: 8, fontSize: 12 }}>
                <span className="chip mono" style={{ fontSize: 9.5 }}>{fmtHash(ref.fileHash, 10)}</span>
                <span>{ref.fileName}</span>
                <span className="spacer" />
                <span className="tiny-2">{ref.rowCount.toLocaleString()} 行</span>
              </div>
            ))}
          </div>
          <div className="divider" />
          <div className="row wrap" style={{ gap: 6 }}>
            <Chip tone="muted" mono>mapping {fmtHash(latest.mappingDigest, 10)}</Chip>
            <Chip tone="muted" mono>assertions {fmtHash(latest.assertionsDigest, 10)}</Chip>
            <Chip tone="muted" mono>{latest.engineVersion}</Chip>
          </div>
        </Panel>
      )}
    </>
  );
}
