import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  CircleHelp,
  Filter,
  MapPin,
  MessagesSquare,
  ShieldQuestion,
  Sparkles,
  Thermometer,
} from 'lucide-react';
import { store, useStore } from '../state/store';
import type { ComplaintResult, ComplaintStatus } from '../types';
import { Callout, Chip, Drawer, Empty, Panel, Stat, Tabs } from '../components/ui/primitives';
import { PageHead } from '../components/Layout';
import { WindowRibbon } from '../components/charts/charts';
import { STATUS_META, dateTime, fmtHash, pct } from '../lib/format';
import { fmtLocal, fmtLocalFull } from '../lib/time';

const FILTERS: { key: ComplaintStatus | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'supported', label: '有据可查' },
  { key: 'partial', label: '部分支持' },
  { key: 'contradicted', label: '未获支持' },
  { key: 'misaligned', label: '无法对齐' },
  { key: 'unverifiable', label: '无法核实' },
  { key: 'unassigned', label: '未归属' },
];

export function ComplaintsPage() {
  const state = useStore();
  const [params, setParams] = useSearchParams();
  const runId = params.get('run');
  const run = (runId ? store.getRun(runId) : state.runs[0]) ?? null;
  const [filter, setFilter] = useState<ComplaintStatus | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(params.get('c'));

  const complaints = useMemo(() => {
    if (!run) return [];
    const all = run.result.complaints;
    return filter === 'all' ? all : all.filter((c) => c.status === filter);
  }, [run, filter]);

  const selected = run?.result.complaints.find((c) => c.complaintId === selectedId) ?? null;

  if (!run) {
    return (
      <>
        <PageHead title="投诉证据" lede="每条投诉都能回答：地址归到哪栋楼、对应探头和工单时段、结论的支持度与不确定范围。" />
        <Panel><Empty title="尚无运行">先启动一次分析，再来查看投诉证据。</Empty></Panel>
      </>
    );
  }

  const t = run.result.totals;
  return (
    <>
      <PageHead
        title="投诉证据"
        lede={
          <>
            运行截止 <strong>{dateTime(run.dataCutoffTs)}</strong>。每条投诉的结论都独立记录其地址归属、监测覆盖、工单交集与不确定范围；未归属投诉保留候选，不塞进最相似的楼栋。
          </>
        }
        actions={
          <>
            <Link to="/mapping" className="btn">
              <MapPin size={13} />
              确认地址归属
            </Link>
            <Link to="/results" className="btn">
              返回结果 <ArrowRight size={13} />
            </Link>
          </>
        }
      />

      <div className="grid c4">
        <Stat label="有据可查" value={t.supportedComplaints} foot="监测与工单共同支持" tone="var(--high)" icon={<Sparkles size={13} color="var(--high)" />} />
        <Stat label="部分支持" value={t.partialComplaints} foot="仅局部/短时证据" tone="var(--medium)" icon={<Thermometer size={13} color="var(--medium)" />} />
        <Stat label="无法核实 / 对齐" value={t.unverifiableComplaints + t.misalignedComplaints} foot="覆盖不足或监测与工单矛盾" tone="var(--unknown)" icon={<ShieldQuestion size={13} color="var(--unknown)" />} />
        <Stat label="未归属" value={t.unassignedComplaints} foot="地址无法唯一归属" tone="var(--cool)" icon={<CircleHelp size={13} color="var(--cool)" />} />
      </div>

      <Callout tone="info" icon={<MessagesSquare size={15} color="var(--cool)" />}>
        投诉是<strong>解释线索</strong>，不是总体判断底表。同样的低温片段，在有据可查的投诉里能解释体感，但不会把无投诉的楼栋排除在监测盲区之外。
      </Callout>

      <Panel pad={false}>
        <div style={{ padding: '0 18px' }}>
          <Tabs
            value={filter}
            onChange={(v) => { setFilter(v); setParams((p) => { p.delete('c'); return p; }); }}
            items={FILTERS.map((f) => ({
              value: f.key,
              label: f.label,
              count: f.key === 'all' ? run.result.complaints.length : run.result.complaints.filter((c) => c.status === f.key).length,
            }))}
          />
        </div>
        {complaints.length === 0 ? (
          <Empty icon={<Filter size={22} />} title="该状态下没有投诉" />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>投诉</th>
                  <th>地址与归属</th>
                  <th>反映时段</th>
                  <th>证据</th>
                  <th>结论</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {complaints.map((c) => (
                  <tr key={c.complaintId} className="clickable" onClick={() => { setSelectedId(c.complaintId); setParams((p) => { p.set('c', c.complaintId); if (runId) p.set('run', runId); return p; }); }}>
                    <td>
                      <div className="mono" style={{ fontSize: 12 }}>{c.complaintId}</div>
                      <div className="tiny-2">{c.channel}</div>
                    </td>
                    <td style={{ maxWidth: 240 }}>
                      <div style={{ fontSize: 12.5 }}>{c.rawAddress}</div>
                      <div className="row wrap" style={{ gap: 4, marginTop: 3 }}>
                        {c.assignedBuildingIds.length ? (
                          c.assignedBuildingIds.map((id) => (
                            <span key={id} className="chip mono" style={{ fontSize: 9.5 }}>{run.mappingSnapshot.buildings.find((b) => b.id === id)?.name ?? id}</span>
                          ))
                        ) : (
                          <span className="tiny-2" style={{ color: 'var(--cool)' }}>未归属 · {c.candidates.length} 个候选</span>
                        )}
                        {c.mappingMode === 'manual' && <Chip tone="teal">人工</Chip>}
                        {c.mappingMode === 'ambiguous' && <Chip tone="cool">待确认</Chip>}
                      </div>
                    </td>
                    <td className="tiny mono">{fmtLocal(c.windowStartTs)}<div className="tiny-2">→ {fmtLocal(c.windowEndTs)}</div></td>
                    <td>
                      <div className="row wrap" style={{ gap: 3 }}>
                        {c.episodes.length > 0 ? (
                          <Chip tone={c.episodes.some((e) => e.kind === 'supply_shortfall') ? 'high' : c.episodes.some((e) => e.kind === 'local_equipment') ? 'medium' : 'cool'}>
                            {c.episodes.length} 个低温片段
                          </Chip>
                        ) : (
                          <span className="tiny-2">无低温片段</span>
                        )}
                        {c.workOrders.length > 0 && <Chip tone="teal">{c.workOrders.length} 条工单</Chip>}
                      </div>
                      <div className="tiny-2" style={{ marginTop: 2 }}>覆盖 {pct(c.coverageRatio)} · {c.readingsCount} 条读数</div>
                    </td>
                    <td>
                      <Chip tone={STATUS_META[c.status].tone}>{STATUS_META[c.status].label}</Chip>
                      <div className="tiny-2" style={{ maxWidth: 260, marginTop: 3 }}>{c.explanation[0]}</div>
                    </td>
                    <td><ArrowRight size={13} color="var(--ink-4)" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <ComplaintDrawer complaint={selected} run={run} onClose={() => { setSelectedId(null); setParams((p) => { p.delete('c'); return p; }); }} />
    </>
  );
}

export function ComplaintDrawer({
  complaint,
  run,
  onClose,
}: {
  complaint: ComplaintResult | null;
  run: import('../types').AnalysisRun;
  onClose: () => void;
}) {
  if (!complaint) return null;
  const buildingDays = run.result.buildingDays.filter(
    (d) => complaint.assignedBuildingIds.includes(d.buildingId) && complaint.dayKeys.includes(d.dayKey),
  );
  const meta = STATUS_META[complaint.status];
  const origin = run.result.buildingDays.flatMap((d) => d.episodes).find((e) => complaint.episodes.some((x) => x.episodeId === e.id));

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span className="row" style={{ gap: 8 }}>
          {complaint.complaintId}
          <Chip tone={meta.tone}>{meta.label}</Chip>
        </span>
      }
      sub={
        <>
          {complaint.channel} · {fmtLocalFull(complaint.windowStartTs)} → {fmtLocalFull(complaint.windowEndTs)}
        </>
      }
    >
      <div style={{ fontSize: 13, color: 'var(--ink-2)', fontStyle: 'italic', borderLeft: '2px solid var(--line)', paddingLeft: 10 }}>
        “{complaint.text}”
      </div>

      <Panel title="地址归属" pad>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontSize: 13 }}>{complaint.rawAddress}</span>
          <div className="spacer" />
          <Chip tone={complaint.mappingMode === 'auto' ? 'teal' : complaint.mappingMode === 'manual' ? 'accent' : 'cool'}>
            {{ auto: '自动匹配', manual: '人工确认', ambiguous: '多候选待确认', unassigned: '无法归属' }[complaint.mappingMode]}
          </Chip>
        </div>
        {complaint.candidates.length > 0 && (
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            {complaint.candidates.map((c) => (
              <div key={c.buildingId}>
                <div className="row" style={{ gap: 7, fontSize: 11.5 }}>
                  <span className="mono" style={{ width: 38 }}>{c.buildingId}</span>
                  <span style={{ width: 46 }}>{run.mappingSnapshot.buildings.find((b) => b.id === c.buildingId)?.name}</span>
                  <div style={{ flex: 1, height: 4, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}>
                    <div style={{ width: `${c.score * 100}%`, height: '100%', borderRadius: 4, background: complaint.assignedBuildingIds.includes(c.buildingId) ? 'var(--teal)' : 'var(--ink-4)' }} />
                  </div>
                  <span className="mono tiny-2">{c.score.toFixed(2)}</span>
                </div>
                <div className="tiny-2" style={{ marginLeft: 91, marginTop: 2 }}>{c.reason}</div>
              </div>
            ))}
          </div>
        )}
        {complaint.mappingMode === 'ambiguous' || complaint.mappingMode === 'unassigned' ? (
          <div style={{ marginTop: 10 }}>
            <Link className="btn sm" to="/mapping">前往人工确认</Link>
          </div>
        ) : null}
      </Panel>

      <Panel title="投诉时段与监测覆盖" pad>
        {complaint.assignedBuildingIds.length === 0 ? (
          <Callout tone="info">
            <div>
              <strong>尚未归属到楼栋，未截取监测数据。</strong>
              <div className="tiny-2" style={{ marginTop: 3 }}>
                这是有意留白：地址只指向 {complaint.candidates.length || '多个'} 个候选楼栋，强行选一个会误导结论。人工确认后，新运行才会纳入这一段监测证据。
              </div>
            </div>
          </Callout>
        ) : (
          <WindowRibbon
            dayKeys={complaint.dayKeys}
            days={buildingDays}
            windowStart={complaint.windowStartTs - (run.config.complaintPaddingMin * 60_000)}
            windowEnd={complaint.windowEndTs + (run.config.complaintPaddingMin * 60_000)}
            buildingIds={complaint.assignedBuildingIds}
            threshold={run.config.comfortThresholdC}
          />
        )}
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          {complaint.assignedBuildingIds.length > 0 && (
            <Chip tone={complaint.coverageRatio >= run.config.minCoverageRatio ? 'low' : 'undetermined'}>
              覆盖 {pct(complaint.coverageRatio)}
            </Chip>
          )}
          <Chip tone="muted">{complaint.readingsCount} 条读数</Chip>
          <Chip tone="muted">{complaint.dayKeys.length} 个供热日</Chip>
          <Chip tone={complaint.windowInRun ? 'low' : 'medium'}>{complaint.windowInRun ? '窗口内' : '窗口外'}</Chip>
        </div>
      </Panel>

      <Panel title="结论与依据" pad>
        <ul className={`bullet-list ${complaint.status === 'supported' ? '' : complaint.status === 'partial' ? 'warn' : 'info'}`}>
          {complaint.explanation.map((x, i) => <li key={i}><span>{x}</span></li>)}
        </ul>
        <div className="divider" />
        <div className="tiny-2" style={{ marginBottom: 4 }}>不确定范围</div>
        <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{complaint.uncertainty || '未记录额外不确定项。'}</div>
      </Panel>

      {complaint.episodes.length > 0 && (
        <Panel title="低温片段" pad>
          <div className="stack" style={{ gap: 6 }}>
            {complaint.episodes.map((e) => (
              <div key={e.episodeId} className="row" style={{ gap: 7 }}>
                <Chip tone={e.kind === 'supply_shortfall' ? 'high' : e.kind === 'local_equipment' ? 'medium' : 'cool'}>
                  {{ transient: '短时扰动', local_equipment: '局部设备', supply_shortfall: '持续不足', unclassified: '待归类' }[e.kind]}
                </Chip>
                <span className="mono tiny">{fmtLocal(e.startTs)}–{fmtLocal(e.endTs)}</span>
                <div className="spacer" />
                <span className="tiny-2">最低 {e.minIndoorC}℃</span>
              </div>
            ))}
          </div>
          {origin && (
            <div className="tiny-2" style={{ marginTop: 8 }}>
              片段来源：{origin.affectedProbeIds.length}/{origin.activeProbeCount} 覆盖（{origin.affectedProbeIds.join('、')}）· 时长不确定 {origin.lowerBoundMin}–{origin.upperBoundMin} 分钟
            </div>
          )}
        </Panel>
      )}

      <Panel title="工单交集" pad>
        {complaint.workOrders.length === 0 ? (
          <div className="tiny muted">投诉时段前后 {run.config.complaintPaddingMin} 分钟内没有工单。</div>
        ) : (
          <div className="stack" style={{ gap: 7 }}>
            {complaint.workOrders.map((o) => (
              <div key={o.id} style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--line-soft)' }}>
                <div className="row" style={{ gap: 7 }}>
                  <span className="mono tiny">{o.id}</span>
                  <Chip tone={o.kind === 'supply_suspension' ? 'high' : 'medium'}>
                    {{ supply_suspension: '停供', valve_adjustment: '阀门调整', maintenance: '检修', complaint_visit: '上门', other: '其他' }[o.kind]}
                  </Chip>
                </div>
                <div className="tiny-2" style={{ marginTop: 3 }}>{o.summary}</div>
                <div className="tiny-2">{fmtLocal(o.startTs)} → {fmtLocal(o.endTs)}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="证据引用" pad>
        <div className="stack" style={{ gap: 5 }}>
          {complaint.refs.length === 0 && <div className="tiny muted">未记录引用。</div>}
          {complaint.refs.map((ref, i) => (
            <div key={i} style={{ fontSize: 11.5 }}>
              <span className="chip mono" style={{ fontSize: 9.5, marginRight: 5 }}>{fmtHash(ref.fileHash, 8)}</span>
              <span>{ref.fileName}</span>
              <div className="tiny-2">{ref.note}</div>
            </div>
          ))}
        </div>
      </Panel>
    </Drawer>
  );
}
