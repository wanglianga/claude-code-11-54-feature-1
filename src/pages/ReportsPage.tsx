import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardCheck, Download, FileText, Printer, ShieldCheck, Lock } from 'lucide-react';
import { store, useStore } from '../state/store';
import { buildReport } from '../lib/runs';
import { Callout, Chip, Empty, KV, Panel } from '../components/ui/primitives';
import { PageHead } from '../components/Layout';
import { RISK_META, STATUS_META, dateTime, download, fmtHash, riskPriority } from '../lib/format';

export function ReportsPage() {
  const state = useStore();
  const [params] = useSearchParams();
  const runId = params.get('run');
  const run = (runId ? store.getRun(runId) : state.runs[0]) ?? null;
  const [copied, setCopied] = useState(false);

  const report = useMemo(() => (run ? buildReport(run, Date.now()) : null), [run]);

  if (!run || !report) {
    return (
      <>
        <PageHead title="运行报告" lede="报告固定引用一次运行的输入与规则，不随后续数据变化。" />
        <Panel><Empty title="尚无报告">先完成一次分析运行。</Empty></Panel>
      </>
    );
  }

  const r = run.result;
  const t = r.totals;

  function toMarkdown(): string {
    const lines: string[] = [];
    lines.push(`# 供热可比性分析运行报告`);
    lines.push('');
    lines.push(`- 运行：${run!.label}`);
    lines.push(`- 运行时间：${dateTime(run!.createdAt)}`);
    lines.push(`- 数据截止：${dateTime(run!.dataCutoffTs)}`);
    lines.push(`- 登记册：v${state.mappings.find((m) => m.id === run!.mappingVersionId)?.version ?? '快照'} · ${fmtHash(run!.mappingDigest, 12)}`);
    lines.push(`- 规则：${run!.engineVersion}`);
    lines.push('');
    lines.push(`## ${report!.narrative.headline}`);
    lines.push('');
    lines.push(report!.narrative.summary);
    lines.push('');
    lines.push('## 主要发现');
    for (const f of report!.narrative.findings) {
      lines.push(`### ${f.title}`);
      lines.push(f.detail);
      lines.push('');
    }
    lines.push('## 输入批次');
    for (const ref of run!.inputRefs) {
      lines.push(`- ${ref.fileName} · ${ref.rowCount} 行 · SHA-256 ${ref.fileHash.slice(0, 20)}… · 到达 ${dateTime(ref.ingestedAt)}`);
    }
    lines.push('');
    lines.push('## 楼栋结论');
    for (const s of r.buildingSummaries) {
      lines.push(`- ${s.name}（${s.buildingId}）：${RISK_META[s.risk].label} — ${s.headline}`);
    }
    lines.push('');
    lines.push('## 投诉证据');
    for (const c of r.complaints) {
      lines.push(`- ${c.complaintId}「${c.rawAddress}」→ ${c.assignedBuildingIds.join('+') || '未归属'}：${STATUS_META[c.status].label}；${c.explanation[0] ?? ''}`);
    }
    lines.push('');
    lines.push('## 规则参数');
    for (const [k, v] of Object.entries(run!.config)) lines.push(`- ${k}: ${v}`);
    lines.push('');
    lines.push('## 局限与注意事项');
    for (const c of report!.narrative.caveats) lines.push(`- ${c}`);
    lines.push('');
    lines.push(`报告校验和（SHA 摘要）：${report!.narrative.checksum}`);
    return lines.join('\n');
  }

  return (
    <>
      <PageHead
        title="运行报告"
        lede={`报告是运行快照的纯函数：输入 ${run.inputRefs.length} 个批次、规则 ${run.engineVersion}、登记册 ${fmtHash(run.mappingDigest, 8)}，不会因为后来又导入数据而变化。`}
        actions={
          <>
            <button
              className="btn"
              onClick={async () => {
                await navigator.clipboard?.writeText(toMarkdown());
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
            >
              <ClipboardCheck size={14} />
              {copied ? '已复制' : '复制 Markdown'}
            </button>
            <button className="btn" onClick={() => download(`供热可比性报告-${run.id}.md`, toMarkdown(), 'text/markdown;charset=utf-8')}>
              <Download size={14} />
              导出 Markdown
            </button>
            <button className="btn primary" onClick={() => window.print()}>
              <Printer size={14} />
              打印 / PDF
            </button>
          </>
        }
      />

      <Callout tone="info" icon={<Lock size={15} color="var(--cool)" />}>
        <strong>报告与结果使用同一份运行快照。</strong> 运行后到达的补录工单与迟到数据不会出现在这里；需要纳入时请新建运行，再生成对应报告。
      </Callout>

      <div className="panel" style={{ padding: '26px 28px' }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div className="tiny-2 mono" style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              供热可比性分析 · 运行报告
            </div>
            <h1 style={{ fontSize: 23, marginTop: 5 }}>{report.narrative.headline}</h1>
            <div className="tiny muted" style={{ marginTop: 3 }}>{run.label}</div>
          </div>
          <div className="spacer" />
          <div className="row" style={{ gap: 6 }}>
            <Chip tone="muted" mono>{run.engineVersion}</Chip>
            <Chip tone="muted" mono>{fmtHash(report.narrative.checksum, 12)}</Chip>
          </div>
        </div>

        <div style={{ marginTop: 16, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.7 }}>{report.narrative.summary}</div>

        <div className="grid c3" style={{ marginTop: 18 }}>
          <ReportStat label="分析窗口" value={`${r.window.startDay} → ${r.window.endDay}`} />
          <ReportStat label="可判断楼栋-供热日" value={`${t.evaluatedDays} / ${t.buildingDays}`} />
          <ReportStat label="非短时低温" value={`${t.observedDeficitHours} h`} />
          <ReportStat label="高风险楼栋" value={`${t.highRiskBuildings}`} tone="var(--high)" />
          <ReportStat
            label="完全无法判断的楼栋"
            value={`${r.buildingSummaries.filter((s) => s.risk === 'undetermined').length}`}
            tone="var(--unknown)"
          />
          <ReportStat label="投诉支持率" value={t.complaints ? `${Math.round(((t.supportedComplaints + t.partialComplaints) / t.complaints) * 100)}%` : '—'} />
        </div>

        <h2 style={{ fontSize: 15, marginTop: 26, marginBottom: 10 }}>主要发现</h2>
        <div className="stack" style={{ gap: 12 }}>
          {report.narrative.findings.map((f, i) => {
            const tone = f.severity === 'high' ? 'var(--high)' : f.severity === 'medium' ? 'var(--medium)' : f.severity === 'undetermined' ? 'var(--unknown)' : 'var(--ink-3)';
            return (
              <div key={i} style={{ paddingLeft: 12, borderLeft: `2px solid ${tone}` }}>
                <div style={{ fontSize: 13, fontWeight: 580 }}>{f.title}</div>
                <div className="tiny" style={{ color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.65 }}>{f.detail}</div>
              </div>
            );
          })}
        </div>

        <h2 style={{ fontSize: 15, marginTop: 26, marginBottom: 8 }}>楼栋结论</h2>
        <table className="table">
          <thead>
            <tr><th>楼栋</th><th>风险</th><th>低温日</th><th>覆盖（日/夜）</th><th>结论</th></tr>
          </thead>
          <tbody>
            {[...r.buildingSummaries].sort((a, b) => riskPriority(a.risk) - riskPriority(b.risk)).map((s) => (
              <tr key={s.buildingId}>
                <td><span className="mono tiny-2">{s.buildingId}</span> {s.name}</td>
                <td><Chip tone={RISK_META[s.risk].tone}>{RISK_META[s.risk].label}</Chip></td>
                <td className="num">{s.deficitDays}{s.documentedDeficitDays ? `（${s.documentedDeficitDays} 有工单）` : ''}</td>
                <td className="tiny mono">{Math.round(s.coverageRatio * 100)}% / {Math.round(s.nightCoverageRatio * 100)}%</td>
                <td className="tiny" style={{ maxWidth: 380 }}>{s.headline}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 style={{ fontSize: 15, marginTop: 26, marginBottom: 8 }}>投诉证据摘要</h2>
        <table className="table">
          <thead>
            <tr><th>投诉</th><th>地址</th><th>归属</th><th>结论</th><th>依据</th></tr>
          </thead>
          <tbody>
            {r.complaints.map((c) => (
              <tr key={c.complaintId}>
                <td className="mono tiny">{c.complaintId}</td>
                <td className="tiny" style={{ maxWidth: 190 }}>{c.rawAddress}</td>
                <td className="tiny mono">{c.assignedBuildingIds.join('+') || '未归属'}</td>
                <td><Chip tone={STATUS_META[c.status].tone}>{STATUS_META[c.status].label}</Chip></td>
                <td className="tiny" style={{ maxWidth: 330 }}>{c.explanation[0]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 style={{ fontSize: 15, marginTop: 26, marginBottom: 8 }}>规则参数（本次运行固定）</h2>
        <div className="report-rules">
          {([
            ['分析窗口', `${run.config.windowStartDay} → ${run.config.windowEndDay}`],
            ['供热日起点', `${String(run.config.heatingDayStartHour).padStart(2, '0')}:00`],
            ['舒适阈值', `${run.config.comfortThresholdC}℃`],
            ['严重偏低', `${run.config.severeThresholdC}℃`],
            ['相对基线下降', `${run.config.deficitDeltaC}℃`],
            ['持续不足阈值', `${run.config.sustainedMinHours} 小时`],
            ['短时扰动上限', `${run.config.windowOpeningMaxMinutes} 分钟`],
            ['夜间时段', `${run.config.nightStartHour}:00 → ${run.config.nightEndHour}:00`],
            ['覆盖下限（日/夜）', `${Math.round(run.config.minCoverageRatio * 100)}% / ${Math.round(run.config.minNightCoverageRatio * 100)}%`],
            ['基线稳定日', `${run.config.baselineMinDays} 天`],
            ['投诉时段扩展', `${run.config.complaintPaddingMin} 分钟`],
            ['地址匹配下限', run.config.complaintMatchMinScore.toFixed(2)],
          ] as const).map(([k, v]) => (
            <div key={k} className="rule-cell">
              <span className="tiny-2">{k}</span>
              <span className="mono tiny">{v}</span>
            </div>
          ))}
        </div>

        <div className="grid c2" style={{ marginTop: 26 }}>
          <div>
            <h2 style={{ fontSize: 15, marginBottom: 8 }}>输入与快照引用</h2>
            <KV
              items={[
                { k: '数据截止', v: dateTime(run.dataCutoffTs) },
                { k: '运行时间', v: dateTime(run.createdAt) },
                { k: '输入批次', v: `${run.inputRefs.length} 个` },
                { k: '登记册', v: `v${state.mappings.find((m) => m.id === run.mappingVersionId)?.version ?? '快照'} · ${fmtHash(run.mappingDigest, 10)}` },
                { k: '地址判断', v: `${run.assertionsSnapshot.length} 条 · ${fmtHash(run.assertionsDigest, 10)}` },
                { k: '规则版本', v: run.engineVersion },
              ]}
            />
            <div className="divider" />
            <div className="stack" style={{ gap: 4 }}>
              {run.inputRefs.map((ref) => (
                <div key={ref.batchId} className="row" style={{ gap: 6, fontSize: 11 }}>
                  <span className="chip mono" style={{ fontSize: 9 }}>{fmtHash(ref.fileHash, 8)}</span>
                  <span>{ref.fileName}</span>
                  <span className="spacer" />
                  <span className="tiny-2">{ref.rowCount.toLocaleString()} 行</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 style={{ fontSize: 15, marginBottom: 8 }}>局限与注意事项</h2>
            <ul className="bullet-list warn">
              {report.narrative.caveats.map((c, i) => <li key={i}><span>{c}</span></li>)}
            </ul>
            <div className="callout" style={{ marginTop: 12 }}>
              <ShieldCheck size={14} color="var(--teal)" />
              <div className="tiny-2">
                本报告由浏览器在本地生成，数据不出本机。校验和用于确认报告内容与运行快照一致。
              </div>
            </div>
          </div>
        </div>

        {run.id !== state.runs[0]?.id && (
          <div className="callout warn" style={{ marginTop: 18 }}>
            <FileText size={14} color="var(--medium)" />
            <div className="tiny">
              这是历史运行报告（{run.label}）。当前最新运行是「{state.runs[0]?.label}」。
              <Link to={`/reports?run=${state.runs[0]?.id}`} className="btn ghost sm" style={{ marginLeft: 8 }}>查看最新</Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function ReportStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--line-soft)' }}>
      <div className="tiny-2">{label}</div>
      <div className="num" style={{ fontSize: 17, fontWeight: 640, color: tone ?? 'var(--ink)', marginTop: 2 }}>{value}</div>
    </div>
  );
}
