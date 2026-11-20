import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  FileSearch,
  Info,
  Layers,
  Ruler,
  ScanSearch,
  ShieldQuestion,
  Thermometer,
} from 'lucide-react';
import { store, useStore } from '../state/store';
import type {
  AnalysisRun,
  BuildingBiasSensitivity,
  ProbeBiasAssessment,
  RiskLevel,
} from '../types';
import { Callout, Chip, Empty, KV, Modal, Panel, Stat } from '../components/ui/primitives';
import { PageHead } from '../components/Layout';
import { RiskBadge } from '../components/charts/charts';
import { RISK_META, dateTime, fmtScore, pct } from '../lib/format';
import { fmtLocalFull } from '../lib/time';
import {
  CALIBRATION_LABELS,
  GATE_LABELS,
  GATE_TONES,
  LIFECYCLE_LABELS,
  ORIENTATION_LABELS,
  ROOM_LABELS,
  WALL_LABELS,
} from '../lib/bias-labels';

export function BiasPage() {
  const state = useStore();
  const [params] = useSearchParams();
  const selectedRunId = params.get('run');
  const run = selectedRunId ? store.getRun(selectedRunId) : state.runs[0];
  const [selected, setSelected] = useState<ProbeBiasAssessment | null>(null);
  const [buildingFilter, setBuildingFilter] = useState<string>('all');

  const probeMap = useMemo(
    () => new Map((run?.mappingSnapshot.probes ?? []).map((p) => [p.id, p])),
    [run],
  );
  const buildingMap = useMemo(
    () => new Map((run?.mappingSnapshot.buildings ?? []).map((b) => [b.id, b])),
    [run],
  );

  if (!run) {
    return (
      <>
        <PageHead title="探头位置偏差" lede="在相同供热日、室外温度与覆盖条件下，区分外墙安装的固定位置效应与探头漂移，给出原始风险、证据调整视图和不可区分区间。" />
        <Panel>
          <Empty icon={<ScanSearch size={26} />} title="还没有可查看的运行">
            先导入样例数据并启动一次分析，偏差评估会随运行快照一起固化。
            <div style={{ marginTop: 12 }}>
              <Link to="/runs" className="btn primary">前往运行 <ArrowRight size={13} /></Link>
            </div>
          </Empty>
        </Panel>
      </>
    );
  }

  const bias = run.result.bias;
  if (!bias) {
    return (
      <>
        <PageHead title="探头位置偏差" lede="该运行由旧版引擎生成，不含偏差评估；请用当前引擎新建运行。" />
        <Panel><Empty title="本运行无偏差套件">历史运行保持其生成时的引擎版本，不会被回填。</Empty></Panel>
      </>
    );
  }

  const filteredAssessments =
    buildingFilter === 'all'
      ? bias.probeAssessments
      : bias.probeAssessments.filter((a) => a.buildingId === buildingFilter);

  return (
    <>
      <PageHead
        title="探头位置偏差与楼栋风险敏感性"
        lede={
          <>
            运行 <strong>{run.label}</strong> · 引擎 <span className="mono">{bias.engineVersion}</span> · 原始读数永不改写，
            所有结论按证据门控给出三视图：<strong>原始视图</strong>、<strong>证据支持的偏差调整视图</strong>、
            <strong>位置效应/漂移不可区分区间</strong>。
          </>
        }
        actions={<Link to="/method" className="btn"><Ruler size={14} /> 两路线方法说明</Link>}
      />

      <Callout tone="info" icon={<Info size={15} color="var(--cool)" />}>
        <strong>为什么不直接把低读数校正？</strong> 外墙探头的稳定低值可能是安装位置的真实空间差异，也可能是探头漂移，
        更可能掩盖真实局部停供。只有位置证据、有效校准证书与足够的同条件邻近比较同时支持时，调整视图才会生成；
        证据不足时保留原始读数并给出不可区分区间，由审查人现场核查。
      </Callout>

      <div className="grid c4">
        <Stat label="路线A 门控通过段" value={bias.routeAEligibleSegments} unit={`/ ${bias.routeAAdjustedSegments} 段已调整`}
          foot={`${bias.comparisonPointCount} 个逐点邻近比较，全部可回查`} tone="var(--teal)"
          icon={<Thermometer size={13} color="var(--teal)" />} />
        <Stat label="路线B 楼栋级适用" value={bias.routeBApplicableBuildingIds.length}
          foot={`${bias.routeBPooledBuildingIds.length} 栋回退全小区池化（借用同类型探头）`}
          tone="var(--cool)" icon={<Layers size={13} color="var(--cool)" />} />
        <Stat label="门控不放行段" value={Object.values(bias.gateIssueCounts).reduce((s, n) => s + (n ?? 0), 0)}
          foot="缺证书/位置证据/邻近覆盖时不自动校正" tone="var(--unknown)"
          icon={<ShieldQuestion size={13} color="var(--unknown)" />} />
        <Stat label="风险敏感性变化楼栋" value={bias.buildingSensitivity.filter((b) => b.changed).length}
          unit={`/ ${bias.buildingSensitivity.length}`} foot="调整视图与原始视图风险不同的楼栋"
          tone="var(--medium)" icon={<FileSearch size={13} color="var(--medium)" />} />
      </div>

      <Panel
        title="楼栋风险敏感性（三视图）"
        sub="原始视图与主分析结果同版本；调整视图仅在门控通过段生效；区间下界为最有利于供热方解释、上界即原始结论。"
        actions={
          <select value={buildingFilter} onChange={(e) => setBuildingFilter(e.target.value)}>
            <option value="all">全部楼栋</option>
            {run.mappingSnapshot.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        }
        pad={false}
      >
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>楼栋</th>
                <th>原始视图</th>
                <th>证据调整视图</th>
                <th>不可区分区间</th>
                <th>驱动探头</th>
                <th>敏感性说明</th>
              </tr>
            </thead>
            <tbody>
              {bias.buildingSensitivity
                .filter((b) => buildingFilter === 'all' || b.buildingId === buildingFilter)
                .map((b) => (
                  <SensitivityRow key={b.buildingId} row={b} name={buildingMap.get(b.buildingId)?.name ?? b.buildingId}
                    probeMap={probeMap} />
                ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid c2">
        <Panel title="探头偏差评估" sub="点击探头查看分段门控、逐日邻近证据与模型预测区间。">
          <div className="stack" style={{ gap: 8 }}>
            {filteredAssessments.map((a) => {
              const probe = probeMap.get(a.probeId);
              const anyAdjusted = a.robust.some((r) => r.adjustmentC !== 0);
              return (
                <button
                  key={a.probeId}
                  className="row"
                  style={{
                    gap: 9, width: '100%', textAlign: 'left', padding: '10px 12px',
                    borderRadius: 10, background: 'rgba(255,255,255,0.025)',
                    border: '1px solid var(--line-soft)', cursor: 'pointer',
                  }}
                  onClick={() => setSelected(a)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 7 }}>
                      <span className="mono" style={{ fontWeight: 600 }}>{a.probeId}</span>
                      <span className="tiny-2">{probe?.label}</span>
                    </div>
                    <div className="row wrap" style={{ gap: 4, marginTop: 5 }}>
                      {a.segments.map((s) => (
                        <Chip key={s.segmentIndex} tone={CALIBRATION_LABELS[s.calibrationStatus].tone}>
                          段{s.segmentIndex} · {CALIBRATION_LABELS[s.calibrationStatus].label}
                        </Chip>
                      ))}
                      {a.gate.reasons.slice(0, 2).map((code) => (
                        <Chip key={code} tone={GATE_TONES[code]}>{GATE_LABELS[code]}</Chip>
                      ))}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {anyAdjusted ? <Chip tone="teal">调整视图生效</Chip> : <Chip tone="muted">保持原始读数</Chip>}
                    <div className="tiny-2" style={{ marginTop: 4 }}>{a.robust.reduce((s, r) => s + r.comparableDayCount, 0)} 个可比日</div>
                  </div>
                </button>
              );
            })}
            {filteredAssessments.length === 0 && <Empty title="该楼栋没有参与评估的活动探头" />}
          </div>
        </Panel>

        <Panel title="路线 B 层级模型适用范围" sub="模型估计不是实测；区间与借用范围必须随结论一起展示。">
          <div className="stack" style={{ gap: 8 }}>
            <div className="tiny-2" style={{ lineHeight: 1.7 }}>{bias.modelSpec.formula}</div>
            <div className="row wrap" style={{ gap: 5 }}>
              {bias.modelSpec.covariates.map((c) => <Chip key={c} mono tone="cool">{c}</Chip>)}
              <Chip tone="muted">区间水平 {pct(bias.modelSpec.intervalLevel)}</Chip>
            </div>
            <div className="tiny-2" style={{ lineHeight: 1.7 }}>{bias.modelSpec.note}</div>
            <div className="divider" />
            {bias.routeBNotApplicable.map((n) => (
              <div key={n.buildingId} style={{ padding: '8px 10px', borderRadius: 9, border: '1px solid var(--line-soft)' }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="mono tiny-2">{n.buildingId}</span>
                  <Chip tone={bias.routeBPooledBuildingIds.includes(n.buildingId) ? 'medium' : 'undetermined'}>
                    {bias.routeBPooledBuildingIds.includes(n.buildingId) ? '池化适用' : '不适用'}
                  </Chip>
                </div>
                <div className="tiny-2" style={{ marginTop: 4, lineHeight: 1.6 }}>{n.reason}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <ProbeBiasDrawer
        assessment={selected}
        run={run}
        onClose={() => setSelected(null)}
        probeLabel={selected ? (probeMap.get(selected.probeId)?.label ?? selected.probeId) : ''}
      />
    </>
  );
}

function SensitivityRow({
  row,
  name,
  probeMap,
}: {
  row: BuildingBiasSensitivity;
  name: string;
  probeMap: Map<string, { label: string }>;
}) {
  return (
    <tr>
      <td>
        <div style={{ fontWeight: 560 }}>{name}</div>
        <div className="tiny-2 mono">{row.buildingId}</div>
      </td>
      <td>
        <RiskBadge risk={row.rawRisk} />
        <div className="tiny-2 mono">score {fmtScore(row.rawRiskScore)}</div>
      </td>
      <td>
        <RiskBadge risk={row.adjustedRisk} />
        <div className="tiny-2 mono">score {fmtScore(row.adjustedRiskScore)}</div>
        {row.changed && <Chip tone="medium">视图间变化</Chip>}
      </td>
      <td className="tiny">
        <div className="row" style={{ gap: 5 }}>
          <Chip tone={RISK_META[row.rangeBound.lowerRisk].tone}>下界 {RISK_META[row.rangeBound.lowerRisk].label}{row.rangeBound.lowerScore !== null ? ` ${row.rangeBound.lowerScore}` : ''}</Chip>
          <ArrowRight size={10} />
          <Chip tone={RISK_META[row.rangeBound.upperRisk].tone}>上界 {RISK_META[row.rangeBound.upperRisk].label}{row.rangeBound.upperScore !== null ? ` ${row.rangeBound.upperScore}` : ''}</Chip>
        </div>
      </td>
      <td className="tiny-2">
        <div className="row wrap" style={{ gap: 4 }}>
          {row.drivingProbeIds.map((id) => <Chip key={id} mono>{id}</Chip>)}
          {row.drivingProbeIds.length === 0 && '—'}
        </div>
      </td>
      <td className="tiny-2" style={{ maxWidth: 320, lineHeight: 1.6 }}>
        {row.explanation.length ? row.explanation.join(' ') : '各探头无显著位置偏差，三视图一致。'}
      </td>
    </tr>
  );
}

function ProbeBiasDrawer({
  assessment,
  run,
  onClose,
  probeLabel,
}: {
  assessment: ProbeBiasAssessment | null;
  run: AnalysisRun;
  onClose: () => void;
  probeLabel: string;
}) {
  if (!assessment) return null;
  const probe = run.mappingSnapshot.probes.find((p) => p.id === assessment.probeId);
  const pos = probe?.position;
  return (
    <Modal
      open={!!assessment}
      wide
      title={`${assessment.probeId} · ${probeLabel}`}
      sub={`设备档案、事件拆段与两条路线的逐项证据；原始读数在所有视图中保持不变。`}
      onClose={onClose}
      footer={<span className="tiny-2" style={{ marginRight: 'auto' }}>依据 {run.engineVersion} · 运行 {run.label}</span>}
    >
      <div className="grid c2">
        <div>
          <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>安装位置档案</h4>
          {pos ? (
            <KV
              items={[
                { k: '楼层/高度', v: `${pos.floor ?? '—'} 层 / ${pos.heightM ?? '—'} m` },
                { k: '朝向', v: ORIENTATION_LABELS[pos.orientation] },
                { k: '墙体位置', v: WALL_LABELS[pos.wallPosition] },
                { k: '房间类型', v: ROOM_LABELS[pos.roomType] },
                { k: '外露说明', v: pos.exposureNote || '—' },
                { k: '位置证据', v: pos.evidenceRef ? `${pos.evidenceRef}${pos.evidenceSinceTs ? `（${dateTime(pos.evidenceSinceTs)} 起）` : ''}` : '缺失（门控不放行）' },
              ]}
            />
          ) : (
            <div className="tiny muted">未登记结构化位置档案。</div>
          )}
          <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 12 }}>校准证书</h4>
          {(probe?.certificates ?? []).length === 0 ? (
            <div className="tiny muted">无校准证书——任何时段都不会自动校正。</div>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {probe!.certificates!.map((c) => (
                <div key={c.id} style={{ padding: '8px 10px', borderRadius: 9, border: '1px solid var(--line-soft)' }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="mono tiny">{c.id}</span>
                    <Chip tone={(c.validUntil ?? 0) > run.dataCutoffTs ? 'low' : 'high'}>
                      {(c.validUntil ?? 0) > run.dataCutoffTs ? '运行时有效' : '已过期'}
                    </Chip>
                  </div>
                  <div className="tiny-2" style={{ marginTop: 4 }}>
                    {c.lab} · 检定 {dateTime(c.calibratedAt)} · 有效期至 {c.validUntil ? dateTime(c.validUntil) : '未标注'}
                    {c.biasAt20C !== null && ` · 20℃ 示值偏差 ${c.biasAt20C}℃`}
                    {c.uncertaintyC !== null && ` · 不确定度 ±${c.uncertaintyC}℃`}
                  </div>
                  <div className="tiny-2">单据 {c.documentRef || '—'} {c.statusNote && `· ${c.statusNote}`}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>事件时间拆段</h4>
          <div className="stack" style={{ gap: 6 }}>
            {assessment.segments.map((s) => (
              <div key={s.segmentIndex} style={{ padding: '8px 10px', borderRadius: 9, border: '1px solid var(--line-soft)' }}>
                <div className="row" style={{ gap: 6 }}>
                  <Chip tone="cool">段 {s.segmentIndex}</Chip>
                  <span className="tiny-2">{LIFECYCLE_LABELS[s.trigger as keyof typeof LIFECYCLE_LABELS] ?? (s.trigger === 'window_start' ? '窗口起点' : '窗口终点')}</span>
                  <Chip tone={CALIBRATION_LABELS[s.calibrationStatus].tone}>{CALIBRATION_LABELS[s.calibrationStatus].label}</Chip>
                  {s.gate.adjustmentAllowed ? <Chip tone="low">门控通过</Chip> : s.gate.reasons.map((c) => <Chip key={c} tone={GATE_TONES[c]}>{GATE_LABELS[c]}</Chip>)}
                </div>
                <div className="tiny-2 mono" style={{ marginTop: 4 }}>
                  {fmtLocalFull(s.startTs)} → {fmtLocalFull(s.endTs)}
                </div>
                {s.triggerEventId && <div className="tiny-2">触发事件 {s.triggerEventId} · 证书 {s.certificateId ?? '无'}</div>}
                {s.gate.detail.length > 0 && (
                  <ul className="bullet-list warn" style={{ marginTop: 4 }}>
                    {s.gate.detail.map((d, i) => <li key={i}><span className="tiny-2">{d}</span></li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
          <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 12 }}>邻近探头关系</h4>
          <div className="row wrap" style={{ gap: 5 }}>
            {(probe?.neighborLinks ?? []).length === 0 && <span className="tiny muted">未登记邻近关系。</span>}
            {(probe?.neighborLinks ?? []).map((n) => (
              <Chip key={n.probeId} mono tone={n.evidenceRef ? 'teal' : 'undetermined'}>
                {n.probeId} · {n.relation}{n.evidenceRef ? '' : '（无关系证据）'}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 14 }}>
        路线 A：固定安装分层的稳健邻近比较（逐点可回查）
      </h4>
      {assessment.robust.map((r) => (
        <div key={r.segmentIndex} style={{ marginBottom: 12 }}>
          <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
            <Chip tone="cool">段 {r.segmentIndex}</Chip>
            <span className="tiny-2">稳健中位差 <b className="mono">{r.persistentDeltaC ?? '—'}℃</b></span>
            <span className="tiny-2">MAD {r.madDeltaC ?? '—'}℃</span>
            <span className="tiny-2">可比日 {r.comparableDayCount}</span>
            <span className="tiny-2">邻近 {r.neighborProbeIds.join('、') || '—'}</span>
            {r.adjustmentC !== 0 && <Chip tone="low">调整视图修正 +{r.adjustmentC}℃</Chip>}
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>供热日</th><th>本探头中位</th><th>邻近中位</th><th>差值</th><th>室外中位</th><th>覆盖（本/邻）</th><th>可比性</th></tr>
              </thead>
              <tbody>
                {r.points.map((p) => (
                  <tr key={p.dayKey}>
                    <td className="mono tiny-2">{p.dayKey}</td>
                    <td className="num tiny-2">{Number.isNaN(p.probeMedianC) ? '—' : p.probeMedianC}</td>
                    <td className="num tiny-2">{Number.isNaN(p.neighborMedianC) ? '—' : p.neighborMedianC}</td>
                    <td className="num tiny-2" style={{ color: p.deltaC <= -0.8 ? 'var(--high)' : undefined }}>
                      {Number.isNaN(p.deltaC) ? '—' : p.deltaC}
                    </td>
                    <td className="num tiny-2">{Number.isNaN(p.outdoorMedianC) ? '—' : p.outdoorMedianC}</td>
                    <td className="tiny-2 mono">{pct(p.probeCoverageRatio)} / {pct(p.neighborCoverageRatio)}</td>
                    <td className="tiny-2">{p.comparable ? <Chip tone="low">可比</Chip> : <Chip tone="undetermined">{p.excludedReason}</Chip>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.adjustmentBasis.length > 0 && (
            <ul className="bullet-list" style={{ marginTop: 5 }}>
              {r.adjustmentBasis.map((b, i) => <li key={i}><span className="tiny-2">{b}</span></li>)}
            </ul>
          )}
        </div>
      ))}

      <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        路线 B：含位置/天气协变量的层级模型（估计值，附预测区间）
      </h4>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr><th>段</th><th>位置固定效应</th><th>探头随机效应（漂移）</th><th>预测区间半宽</th><th>收缩系数</th><th>样本日</th><th>适用范围说明</th></tr>
          </thead>
          <tbody>
            {assessment.model.map((m) => (
              <tr key={m.segmentIndex}>
                <td className="mono tiny-2">{m.segmentIndex}</td>
                <td className="num tiny-2">{m.positionEffectC ?? '—'}℃</td>
                <td className="num tiny-2">{m.driftEffectC ?? '—'}℃</td>
                <td className="num tiny-2">{m.intervalHalfWidthC !== null ? `±${m.intervalHalfWidthC}℃（${pct(m.intervalLevel)}）` : '—'}</td>
                <td className="num tiny-2">{m.shrinkage}</td>
                <td className="num tiny-2">{m.sampleCount}</td>
                <td className="tiny-2" style={{ lineHeight: 1.6 }}>
                  {m.applicable ? m.applicabilityNotes.join(' ') : <Chip tone="undetermined">模型不适用，仅保留路线 A 证据</Chip>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="tiny-2" style={{ letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 12 }}>
        位置效应 / 漂移 不可区分区间
      </h4>
      {assessment.indistinguishableRangeC ? (
        <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(106,169,233,0.35)', background: 'rgba(106,169,233,0.06)' }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="tiny-2">观测邻近中位差 <b className="mono">{assessment.indistinguishableRangeC.observedDeltaC}℃</b></span>
            <span className="tiny-2">
              位置分量 {assessment.indistinguishableRangeC.positionComponent.lowerC} ~ {assessment.indistinguishableRangeC.positionComponent.upperC}℃
            </span>
            <span className="tiny-2">
              漂移分量 {assessment.indistinguishableRangeC.driftComponent.lowerC} ~ {assessment.indistinguishableRangeC.driftComponent.upperC}℃
            </span>
          </div>
          <ul className="bullet-list" style={{ marginTop: 6 }}>
            {assessment.indistinguishableRangeC.basis.map((b, i) => <li key={i}><span className="tiny-2">{b}</span></li>)}
          </ul>
        </div>
      ) : (
        <div className="tiny muted">窗口内无可比邻近供热日，无法建立区间；该探头结论保持原始视图。</div>
      )}
      {assessment.notes.length > 0 && (
        <ul className="bullet-list warn" style={{ marginTop: 8 }}>
          {assessment.notes.map((n, i) => <li key={i}><span className="tiny-2">{n}</span></li>)}
        </ul>
      )}
    </Modal>
  );
}
