import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ClipboardCheck,
  Eye,
  EyeOff,
  FileSearch,
  Info,
  Layers,
  Radar,
  ScanSearch,
  ShieldAlert,
  ShieldQuestion,
  Timer,
} from 'lucide-react';
import { store, useStore } from '../state/store';
import type { AnalysisRun, BuildingDayResult, RiskLevel } from '../types';
import { Callout, Chip, Empty, KV, Modal, Panel, Stat } from '../components/ui/primitives';
import { PageHead } from '../components/Layout';
import { ClassLegend, CoverageMatrix, DayChart, RiskBadge, WindowRibbon } from '../components/charts/charts';
import { DAY_CLASS_META, RISK_META, STATUS_META, dateTime, fmtHash, fmtScore, pct } from '../lib/format';
import { fmtDayLabel, fmtLocal, fmtLocalFull } from '../lib/time';
import { GATE_LABELS, GATE_TONES } from '../lib/bias-labels';

export function ResultsPage() {
  const state = useStore();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const selectedRunId = params.get('run');
  const run = selectedRunId ? store.getRun(selectedRunId) : state.runs[0];
  const [cell, setCell] = useState<BuildingDayResult | null>(null);
  const [focusBuilding, setFocusBuilding] = useState<string | null>(null);
  const [metric, setMetric] = useState<'class' | 'coverage'>('class');
  const [lateOpen, setLateOpen] = useState(params.get('late') === '1');

  if (!run) {
    return (
      <>
        <PageHead title="分析结果" lede="以楼栋 × 供热日覆盖面为底表，投诉作为解释线索关联。" />
        <Panel>
          <Empty icon={<ScanSearch size={26} />} title="还没有可查看的运行">
            先导入样例数据，然后在「运行」页启动分析。
            <div style={{ marginTop: 12 }}>
              <Link to="/runs" className="btn primary">
                前往运行 <ArrowRight size={13} />
              </Link>
            </div>
          </Empty>
        </Panel>
      </>
    );
  }

  const r = run.result;
  const t = r.totals;
  const isLatest = state.runs[0]?.id === run.id;
  const comparison = isLatest ? state.comparison : null;
  const late = isLatest ? state.lateData : [];
  const buildings = focusBuilding
    ? r.buildingSummaries.filter((b) => b.buildingId === focusBuilding)
    : r.buildingSummaries;
  const daysForMatrix = focusBuilding ? r.buildingDays.filter((d) => d.buildingId === focusBuilding) : r.buildingDays;

  return (
    <>
      <PageHead
        title="分析结果"
        lede={
          <>
            运行截止 <strong>{dateTime(run.dataCutoffTs)}</strong> · 登记册快照 <span className="mono">{fmtHash(run.mappingDigest, 8)}</span> · 规则 <span className="mono">{run.engineVersion}</span>
            。图表与结论卡使用同一分母；运行后到达的数据只提示，不局部刷新。
          </>
        }
        actions={
          <>
            <Link to={`/reports?run=${run.id}`} className="btn">
              <ClipboardCheck size={14} />
              查看报告
            </Link>
            <div className="seg">
              <button className={metric === 'class' ? 'active' : ''} onClick={() => setMetric('class')}>分类</button>
              <button className={metric === 'coverage' ? 'active' : ''} onClick={() => setMetric('coverage')}>覆盖率</button>
            </div>
          </>
        }
      />

      {late.length > 0 && (
        <Callout tone="warn" icon={<Timer size={16} color="var(--medium)" />}>
          <div className="row wrap" style={{ gap: 8 }}>
            <strong>{late.length} 个批次在本运行截止后到达。</strong>
            <span>它们不会改写本次运行的图表与结论卡；如需纳入，请新建运行。</span>
            <div className="spacer" />
            <button className="btn sm" onClick={() => setLateOpen(true)}>查看覆盖截止说明</button>
          </div>
        </Callout>
      )}

      {isLatest && comparison && comparison.currentRunId === run.id && (comparison.affectedComplaints.length > 0 || comparison.buildingDeltas.length > 0 || comparison.configChanged) && (
        <Panel title="与上一次运行相比" sub="差异来自登记册修订、地址确认或新数据。">
          <div className="grid c2">
            <div>
              <div className="tiny-2" style={{ marginBottom: 6 }}>受影响投诉（{comparison.affectedComplaints.length}）</div>
              {comparison.affectedComplaints.length === 0 ? (
                <div className="tiny muted">无。</div>
              ) : (
                <div className="stack" style={{ gap: 6 }}>
                  {comparison.affectedComplaints.map((c) => (
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
              )}
            </div>
            <div>
              <div className="tiny-2" style={{ marginBottom: 6 }}>楼栋风险变化（{comparison.buildingDeltas.length}）</div>
              {comparison.buildingDeltas.length === 0 ? (
                <div className="tiny muted">无。</div>
              ) : (
                <div className="stack" style={{ gap: 6 }}>
                  {comparison.buildingDeltas.map((d) => (
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
              )}
            </div>
          </div>
        </Panel>
      )}

      <div className="grid c4">
        <Stat label="可判断的楼栋-供热日" value={t.evaluatedDays} unit={`/ ${t.buildingDays}`} foot={`${t.indeterminateDays} 个无法判断，未计入风险`} tone="var(--teal)" icon={<Layers size={13} color="var(--teal)" />} />
        <Stat label="高风险楼栋" value={t.highRiskBuildings} unit={`/ ${t.buildings}`} foot={`${t.mediumRiskBuildings} 栋中等风险 · ${t.undeterminedBuildings} 栋无法判断`} tone="var(--high)" icon={<ShieldAlert size={13} color="var(--high)" />} />
        <Stat label="非短时低温小时" value={t.observedDeficitHours} unit="h" foot={`其中 ${t.documentedDeficitHours} 小时有工单印证`} tone="var(--medium)" icon={<Timer size={13} color="var(--medium)" />} />
        <Stat
          label="投诉证据分布"
          value={`${t.supportedComplaints}+${t.partialComplaints}`}
          unit={`/ ${t.complaints}`}
          foot={`支持+部分支持 = ${t.supportedComplaints} + ${t.partialComplaints}；其余：${t.contradictedComplaints} 未获支持、${t.misalignedComplaints} 无法对齐、${t.unverifiableComplaints} 无法核实、${t.unassignedComplaints} 未归属`}
          tone="var(--cool)"
          icon={<FileSearch size={13} color="var(--cool)" />}
        />
      </div>

      <Callout tone="info" icon={<Info size={15} color="var(--cool)" />}>
        <strong>底表逻辑：</strong>先为每栋楼建立按供热日排列的监测覆盖面，再把投诉作为解释线索关联进去。因此无投诉的楼栋也可能因覆盖不足进入「监测盲区」，而不会显示成“没有风险”。
      </Callout>

      {r.bias && (
        <Callout tone="info" icon={<Radar size={15} color="var(--teal)" />}>
          <div className="row wrap" style={{ gap: 8 }}>
            <strong>位置偏差敏感性已随本运行固化。</strong>
            <span>
              路线 A 门控通过 {r.bias.routeAEligibleSegments} 段、调整视图生效 {r.bias.routeAAdjustedSegments} 段；
              {r.bias.buildingSensitivity.filter((b) => b.changed).length} 栋楼在调整视图下风险变化，
              原始视图与原始读数保持不变。
            </span>
            <div className="spacer" />
            <Link to={`/bias?run=${run.id}`} className="btn sm">查看位置偏差评估 <ArrowRight size={12} /></Link>
          </div>
        </Callout>
      )}

      <Panel
        title="楼栋 × 供热日 覆盖面"
        sub={focusBuilding ? `聚焦 ${r.buildingSummaries.find((b) => b.buildingId === focusBuilding)?.name}` : '整表视图；点击行聚焦单栋，点击单元格查看当日证据。'}
        actions={
          <>
            {focusBuilding && (
              <button className="btn sm" onClick={() => setFocusBuilding(null)}>
                <EyeOff size={12} /> 取消聚焦
              </button>
            )}
            <span className="tiny-2">{metric === 'class' ? '按分类着色' : '按覆盖率着色（%）'}</span>
          </>
        }
        pad={false}
      >
        <div className="panel-body" style={{ paddingBottom: 6 }}>
          <CoverageMatrix days={daysForMatrix} summaries={buildings} onCell={setCell} onRow={(id) => setFocusBuilding(focusBuilding === id ? null : id)} metric={metric} />
        </div>
        <div className="panel-body" style={{ paddingTop: 0 }}>
          {metric === 'class' ? <ClassLegend /> : (
            <div className="legend">
              <span><i style={{ background: 'rgba(88,193,178,0.7)' }} />覆盖高</span>
              <span><i style={{ background: 'rgba(88,193,178,0.25)' }} />覆盖中</span>
              <span><i style={{ background: 'rgba(229,100,92,0.55)' }} />覆盖低</span>
              <span className="tiny-2">数字 = 该供热日有效读数 / 应到条数。</span>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="楼栋风险与可核查性" sub="风险分数来自可判断的供热日；无法判断的天数单列，不折算成低风险。" pad={false}>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>楼栋</th>
                <th>风险</th>
                <th>判断依据</th>
                <th style={{ textAlign: 'right' }}>低温日</th>
                <th style={{ textAlign: 'right' }}>无法判断</th>
                <th>覆盖率（日/夜）</th>
                <th>投诉</th>
                <th>设备可信度</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...r.buildingSummaries].sort((a, b) => riskOrder(a.risk) - riskOrder(b.risk)).map((s) => (
                <tr key={s.buildingId} className="clickable" onClick={() => setFocusBuilding(focusBuilding === s.buildingId ? null : s.buildingId)}>
                  <td>
                    <div style={{ fontWeight: 560 }}>{s.name}</div>
                    <div className="tiny-2">{s.probeCount} 个探头</div>
                  </td>
                  <td>
                    <RiskBadge risk={s.risk} />
                    {s.riskScore !== null && <div className="tiny-2 mono">score {fmtScore(s.riskScore)}</div>}
                  </td>
                  <td className="tiny" style={{ maxWidth: 250 }}>{s.headline}</td>
                  <td className="num" style={{ textAlign: 'right' }}>
                    {s.deficitDays}
                    {s.documentedDeficitDays > 0 && <div className="tiny-2">{s.documentedDeficitDays} 有工单</div>}
                  </td>
                  <td className="num" style={{ textAlign: 'right', color: s.indeterminateDays ? 'var(--unknown)' : 'var(--ink-3)' }}>{s.indeterminateDays}</td>
                  <td className="tiny">
                    <div className="row" style={{ gap: 5 }}>
                      <span className="mono">{pct(s.coverageRatio)}</span>
                      <span className="tiny-2">/</span>
                      <span className="mono">{pct(s.nightCoverageRatio)}</span>
                    </div>
                    <div style={{ height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.08)', marginTop: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${s.coverageRatio * 100}%`, height: '100%', background: s.coverageRatio >= 0.6 ? 'var(--teal)' : 'var(--unknown)' }} />
                    </div>
                  </td>
                  <td>
                    {s.complaint.total === 0 ? (
                      <span className="tiny-2">—</span>
                    ) : (
                      <div className="row wrap" style={{ gap: 3 }}>
                        {s.complaint.supported > 0 && <Chip tone="high" >{s.complaint.supported} 支持</Chip>}
                        {s.complaint.partial > 0 && <Chip tone="medium">{s.complaint.partial} 部分</Chip>}
                        {s.complaint.contradicted > 0 && <Chip tone="low">{s.complaint.contradicted} 未支持</Chip>}
                        {s.complaint.misaligned > 0 && <Chip tone="undetermined">{s.complaint.misaligned} 无法对齐</Chip>}
                        {s.complaint.unverifiable > 0 && <Chip tone="undetermined">{s.complaint.unverifiable} 无法核实</Chip>}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 56, height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                        <div style={{ width: `${s.equipmentConfidence * 100}%`, height: '100%', background: s.equipmentConfidence >= 0.6 ? 'var(--teal)' : 'var(--medium)' }} />
                      </div>
                      <span className="tiny-2 mono">{Math.round(s.equipmentConfidence * 100)}%</span>
                    </div>
                  </td>
                  <td><Eye size={13} color="var(--ink-4)" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid c2">
        <Panel title="监测盲区" sub="覆盖不足的楼栋单独标出，不读作“没有供热问题”。">
          {r.blindSpots.length === 0 ? (
            <div className="row" style={{ gap: 8 }}>
              <CheckCircle2 size={16} color="var(--low)" />
              <span className="tiny">窗口内没有监测盲区。</span>
            </div>
          ) : (
            <div className="stack" style={{ gap: 9 }}>
              {r.blindSpots.map((b) => (
                <div key={b.buildingId} style={{ padding: '9px 11px', borderRadius: 9, background: 'rgba(156,143,208,0.07)', border: '1px solid rgba(156,143,208,0.25)' }}>
                  <div className="row" style={{ gap: 6 }}>
                    <ShieldQuestion size={13} color="var(--unknown)" />
                    <strong style={{ fontSize: 12.5 }}>{b.buildingName}</strong>
                    {b.complaintCount > 0 && <Chip tone="undetermined">{b.complaintCount} 条投诉无法核实</Chip>}
                  </div>
                  <div className="tiny-2" style={{ marginTop: 3 }}>{b.reason}</div>
                  <div className="tiny-2" style={{ marginTop: 2 }}>
                    受影响供热日：{b.affectedDays.length ? b.affectedDays.map(fmtDayLabel).join('、') : '全窗口'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="对齐问题" sub="来源之间无法互相印证的部分，会同时降低「对齐可信度」。">
          {r.alignmentIssues.length === 0 ? (
            <div className="tiny muted">未发现来源对齐问题。</div>
          ) : (
            <ul className="bullet-list warn">
              {r.alignmentIssues.map((i) => (
                <li key={i.code}>
                  <span>{i.message}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="divider" />
          <div className="tiny-2">
            诊断：读数去重 {r.diagnostics.duplicateReadingsRemoved} 条 · 窗口外读数 {r.diagnostics.outOfWindowReadings.toLocaleString()} 条 · 未归属地址 {r.diagnostics.unresolvedAddresses} 条
          </div>
        </Panel>
      </div>

      <DayDetail
        day={cell}
        run={run}
        onClose={() => setCell(null)}
        onOpenComplaint={(id) => navigate(`/complaints?run=${run.id}&c=${id}`)}
      />

      <Modal
        open={lateOpen}
        title="覆盖截止点说明"
        sub={`本运行截止 ${dateTime(run.dataCutoffTs)}；以下批次在此之后到达。`}
        onClose={() => setLateOpen(false)}
        footer={<button className="btn" onClick={() => setLateOpen(false)}>知道了</button>}
      >
        <div className="callout warn">
          <div>
            <strong>图表与结论卡使用同一截止分母。</strong> 迟到数据不会触发局部刷新——如果只更新图表而不更新结论卡，结论会引用旧分母，这正是本工具要避免的错误。
          </div>
        </div>
        {late.map((n) => (
          <div key={n.batchId} style={{ padding: '10px 12px', borderRadius: 9, border: '1px solid var(--line-soft)' }}>
            <div className="row" style={{ gap: 8 }}>
              <Chip tone="medium">{n.kind === 'work_orders' ? '工单补录' : n.kind === 'readings' ? '迟到读数' : n.kind}</Chip>
              <strong style={{ fontSize: 12.5 }}>{n.fileName}</strong>
            </div>
            <div className="tiny-2" style={{ marginTop: 4 }}>{n.message}</div>
            {n.eventStartTs && (
              <div className="tiny-2" style={{ marginTop: 2 }}>
                涉及事件时间：{fmtLocalFull(n.eventStartTs)} → {fmtLocalFull(n.eventEndTs ?? n.eventStartTs)}（{n.rowsInWindow} 条窗口内记录）
              </div>
            )}
          </div>
        ))}
        <div className="row">
          <span className="tiny-2">需要纳入这些数据时：</span>
          <div className="spacer" />
          <Link to="/runs" className="btn primary sm">新建运行</Link>
        </div>
      </Modal>
    </>
  );
}

function riskOrder(r: RiskLevel): number {
  return r === 'high' ? 0 : r === 'medium' ? 1 : r === 'undetermined' ? 2 : 3;
}

function BiasDayNotice({
  run,
  buildingId,
  dayKey,
  probeIds,
}: {
  run: AnalysisRun;
  buildingId: string;
  dayKey: string;
  probeIds: string[];
}) {
  const bias = run.result.bias;
  if (!bias) return null;
  const dayStart = run.result.buildingDays.find((d) => d.buildingId === buildingId && d.dayKey === dayKey)?.dayStartTs;
  const rows = probeIds
    .map((id) => {
      const a = bias.probeAssessments.find((x) => x.probeId === id);
      if (!a || dayStart === undefined) return null;
      const seg = a.segments.find((s) => dayStart >= s.startTs && dayStart < s.endTs);
      const robust = a.robust.find((r) => r.segmentIndex === seg?.segmentIndex);
      return { a, seg, robust, id };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (!rows.length) return null;
  return (
    <div>
      <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
        当日位置偏差门控
      </h4>
      <div className="stack" style={{ gap: 6 }}>
        {rows.map(({ id, seg, robust }) => (
          <div key={id} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="mono tiny" style={{ width: 70 }}>{id}</span>
            {seg?.gate.adjustmentAllowed ? (
              <Chip tone="low">门控通过，调整视图 {robust && robust.adjustmentC !== 0 ? `+${robust.adjustmentC}℃` : '无修正量'}</Chip>
            ) : (
              (seg?.gate.reasons ?? []).map((code) => (
                <Chip key={code} tone={GATE_TONES[code]}>{GATE_LABELS[code]}</Chip>
              ))
            )}
            {robust?.persistentDeltaC !== null && robust?.persistentDeltaC !== undefined && (
              <span className="tiny-2">邻近中位差 {robust.persistentDeltaC}℃（{robust.comparableDayCount} 个可比日）</span>
            )}
            <span className="tiny-2 muted">原始读数不修改</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 7 }}>
        <Link to={`/bias?run=${run.id}`} className="btn ghost sm">打开位置偏差评估 <ArrowRight size={12} /></Link>
      </div>
    </div>
  );
}

function CheckCircle2(props: { size: number; color: string }) {
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke={props.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.4 2.4 4.6-4.8" />
    </svg>
  );
}

export function DayDetail({
  day,
  run,
  onClose,
  onOpenComplaint,
}: {
  day: BuildingDayResult | null;
  run: AnalysisRun;
  onClose: () => void;
  onOpenComplaint?: (id: string) => void;
}) {
  if (!day) return null;
  const meta = DAY_CLASS_META[day.classification];
  const complaints = run.result.complaints.filter((c) => day.complaintIds.includes(c.complaintId));
  return (
    <Modal
      open={!!day}
      wide
      title={`${day.buildingName} · ${fmtDayLabel(day.dayKey)}`}
      sub={
        <>
          {day.dayKey} 06:00 供热日 · <span style={{ color: meta.text }}>{meta.label}</span> · 覆盖 {pct(day.coverage.coverageRatio)}（夜间 {pct(day.coverage.nightCoverageRatio)}）
        </>
      }
      onClose={onClose}
      footer={
        <>
          <span className="tiny-2" style={{ marginRight: 'auto' }}>
            依据规则 {run.engineVersion} · 登记册快照 {fmtHash(run.mappingDigest, 8)}
          </span>
          <button className="btn" onClick={onClose}>关闭</button>
        </>
      }
    >
      <div className="callout" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--line)' }}>
        <div>
          <strong>{meta.label}。</strong> {meta.desc}
        </div>
      </div>

      <DayChart
        day={day}
        threshold={run.config.comfortThresholdC}
        severe={run.config.severeThresholdC}
        startHour={run.config.heatingDayStartHour}
        orders={run.result.workOrders.filter((o) => o.buildingId === day.buildingId)}
      />
      <div className="legend" style={{ marginTop: -4 }}>
        <span><i style={{ background: 'var(--accent)' }} />室内（小时中位）</span>
        <span><i style={{ background: 'var(--cool)' }} />室外</span>
        <span><i style={{ background: 'rgba(229,100,92,0.85)' }} />停供工单</span>
        <span><i style={{ background: 'rgba(224,168,74,0.8)' }} />阀门调整</span>
        <span><i style={{ background: 'rgba(156,143,208,0.7)' }} />其他工单</span>
        <span><i style={{ background: 'rgba(106,169,233,0.18)' }} />夜间</span>
      </div>

      {day.episodes.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>低温片段</h4>
          {day.episodes.map((ep) => (
            <div key={ep.id} style={{ padding: '9px 11px', borderRadius: 9, border: '1px solid var(--line-soft)', background: 'rgba(255,255,255,0.02)' }}>
              <div className="row" style={{ gap: 6 }}>
                <Chip tone={ep.kind === 'supply_shortfall' ? 'high' : ep.kind === 'local_equipment' ? 'medium' : 'cool'}>
                  {{ transient: '短时扰动', local_equipment: '局部设备', supply_shortfall: '持续不足', unclassified: '待归类' }[ep.kind]}
                </Chip>
                <span className="mono tiny">{fmtLocal(ep.startTs)} → {fmtLocal(ep.endTs)}</span>
                <span className="tiny-2">{ep.durationMin} 分钟</span>
                <div className="spacer" />
                <span className="tiny-2">最低 {ep.minIndoorC}℃</span>
              </div>
              <div className="tiny-2" style={{ marginTop: 4 }}>
                影响 {ep.affectedProbeIds.length}/{ep.activeProbeCount} 个探头（{ep.affectedProbeIds.join('、') || '—'}）
                {ep.nightMinutes > 0 ? ` · 其中夜间 ${ep.nightMinutes} 分钟` : ''}
                {ep.workOrderIds.length > 0 ? ` · 工单 ${ep.workOrderIds.join('、')}` : ' · 无同期工单'}
              </div>
              <div className="tiny-2" style={{ marginTop: 2 }}>
                时长不确定范围：{ep.lowerBoundMin}–{ep.upperBoundMin} 分钟（采样间隔与阈值灵敏度）
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid c2">
        <div>
          <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>判定解释</h4>
          <ul className="bullet-list">
            {day.explanation.map((x, i) => <li key={i}><span>{x}</span></li>)}
          </ul>
        </div>
        <div>
          <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>不确定范围</h4>
          {day.uncertainties.length === 0 ? (
            <div className="tiny muted">未记录额外不确定项。</div>
          ) : (
            <ul className="bullet-list warn">
              {day.uncertainties.map((x, i) => <li key={i}><span>{x}</span></li>)}
            </ul>
          )}
        </div>
      </div>

      <KV
        items={[
          { k: '基线', v: day.baseline.valueC === null ? '不可用' : `${day.baseline.valueC}℃（p20 ${day.baseline.p20C} – p80 ${day.baseline.p80C}，${day.baseline.daysUsed} 个稳定日）` },
          { k: '设备可信度', v: `${Math.round(day.equipmentConfidence * 100)}%` },
          { k: '对齐可信度', v: `${Math.round(day.alignmentConfidence * 100)}%` },
          { k: '气象覆盖', v: pct(day.coverage.weatherCoverageRatio) },
          { k: '当日工单', v: day.workOrderIds.length ? day.workOrderIds.join('、') : '无' },
        ]}
      />

      {day.coverage.probes.length > 0 && (
        <div>
          <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>探头覆盖与中断</h4>
          <div className="stack" style={{ gap: 6 }}>
            {day.coverage.probes.map((p) => (
              <div key={p.probeId} className="row" style={{ gap: 8 }}>
                <span className="mono tiny" style={{ width: 70 }}>{p.probeId}</span>
                <div style={{ flex: 1, height: 5, borderRadius: 5, background: 'rgba(255,255,255,0.06)' }}>
                  <div style={{ width: `${p.coverageRatio * 100}%`, height: '100%', borderRadius: 5, background: p.coverageRatio >= 0.6 ? 'var(--teal)' : 'var(--unknown)' }} />
                </div>
                <span className="tiny-2 mono" style={{ width: 80, textAlign: 'right' }}>{p.received}/{p.expected}</span>
                <span className={`chip ${p.gaps.length ? 'medium' : 'muted'}`} style={{ fontSize: 9.5 }}>
                  {p.gaps.length ? `${p.gaps.length} 处中断` : '连续'}
                </span>
              </div>
            ))}
          </div>
          {day.coverage.probes.some((p) => p.gaps.length > 0) && (
            <div className="tiny-2" style={{ marginTop: 5 }}>
              {day.coverage.probes.flatMap((p) => p.gaps.slice(0, 1).map((g) => `${p.probeId} ${fmtLocal(g.startTs)}–${fmtLocal(g.endTs)}（${g.minutes} 分钟）`)).join('；')}
            </div>
          )}
        </div>
      )}

      {run.result.bias && (
        <BiasDayNotice run={run} buildingId={day.buildingId} dayKey={day.dayKey} probeIds={day.coverage.activeProbeIds} />
      )}

      <div>
        <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>证据引用</h4>
        <div className="stack" style={{ gap: 5 }}>
          {day.refs.map((ref, i) => (
            <div key={i} className="row" style={{ gap: 8, fontSize: 11.5 }}>
              <span className="chip mono" style={{ fontSize: 9.5 }}>{fmtHash(ref.fileHash, 8)}</span>
              <span>{ref.fileName}</span>
              <span className="tiny-2">{ref.note}</span>
            </div>
          ))}
        </div>
      </div>

      {complaints.length > 0 && (
        <div>
          <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>关联投诉</h4>
          <div className="stack" style={{ gap: 5 }}>
            {complaints.map((c) => (
              <div key={c.complaintId} className="row" style={{ gap: 7, fontSize: 11.5 }}>
                <span className="mono">{c.complaintId}</span>
                <span className="muted">{c.rawAddress}</span>
                <Chip tone={STATUS_META[c.status].tone}>{STATUS_META[c.status].label}</Chip>
                <div className="spacer" />
                {onOpenComplaint && <button className="btn ghost sm" onClick={() => onOpenComplaint(c.complaintId)}>查看证据</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
