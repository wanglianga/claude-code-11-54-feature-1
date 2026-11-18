import { useMemo, useRef, useState } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  Braces,
  Trash2,
  Hash,
  CalendarRange,
  Columns3,
  CheckCircle2,
  AlertTriangle,
  Download,
  RefreshCcw,
  CloudDownload,
  Info,
} from 'lucide-react';
import { store, useStore } from '../state/store';
import type { ImportBatch, SourceKind } from '../types';
import { KIND_META } from '../lib/sources';
import { FIELD_SPECS } from '../lib/parse';
import { bytes, dateTime, fmtHash } from '../lib/format';
import { Callout, Chip, Empty, Modal, Panel, Tabs } from '../components/ui/primitives';
import { PageHead } from '../components/Layout';

export function SourcesPage() {
  const state = useStore();
  const [tab, setTab] = useState<'all' | SourceKind>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dictOpen, setDictOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const batches = useMemo(
    () => (tab === 'all' ? state.batches : state.batches.filter((b) => b.kind === tab)),
    [state.batches, tab],
  );
  const detail = state.batches.find((b) => b.id === detailId) ?? null;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = await Promise.all(
      [...files].map(async (f) => ({ name: f.name, text: await f.text() })),
    );
    await store.importTextFiles(list);
  }

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: state.batches.length };
    for (const b of state.batches) out[b.kind] = (out[b.kind] ?? 0) + 1;
    return out;
  }, [state.batches]);

  const totalRows = state.batches.reduce((s, b) => s + b.rowCount, 0);
  const invalid = state.batches.reduce((s, b) => s + b.invalidCount, 0);
  const hasRegistry = state.batches.some((b) => b.kind === 'registry');

  return (
    <>
      <PageHead
        title="来源登记"
        lede="每份导入文件都记录 SHA-256 哈希、字段解释、时间覆盖与质量问题。分析运行固定引用这里的批次快照；之后重新导入同源文件不会改写历史结论。"
        actions={
          <>
            <button className="btn" onClick={() => store.importSamples()} disabled={!!state.busy}>
              <CloudDownload size={14} />
              导入随题样例
            </button>
            <button className="btn" onClick={() => setDictOpen(true)}>
              <Columns3 size={14} />
              字段说明
            </button>
            <button
              className="btn danger"
              onClick={() => {
                if (window.confirm('清空本地工作区？导入批次、人工确认与运行快照都会删除，且不可恢复。')) {
                  void store.clearAll();
                }
              }}
              disabled={!state.batches.length && !state.runs.length}
            >
              <Trash2 size={14} />
              清空工作区
            </button>
          </>
        }
      />

      <div className="grid c4">
        <MiniStat label="导入批次" value={state.batches.length} foot={`${state.batches.filter((b) => b.kind !== 'registry').length} 个数据源 · ${state.batches.filter((b) => b.kind === 'registry').length} 个登记册`} />
        <MiniStat label="数据行" value={totalRows.toLocaleString()} foot="含重复与坏行，解析时分别计数" />
        <MiniStat label="解析异常" value={invalid} foot={invalid ? '见各批次问题列表' : '未发现结构问题'} tone={invalid ? 'var(--medium)' : undefined} />
        <MiniStat
          label="登记册"
          value={hasRegistry ? '已登记' : '未导入'}
          foot={hasRegistry ? `${state.mappings.at(-1)?.buildings.length ?? 0} 栋楼 · ${state.mappings.at(-1)?.probes.length ?? 0} 个探头` : '请导入 registry.json'}
          tone={hasRegistry ? 'var(--teal)' : 'var(--medium)'}
        />
      </div>

      {invalid > 0 && (
        <Callout tone="warn" icon={<AlertTriangle size={15} color="var(--medium)" />}>
          <strong>解析中发现异常行。</strong>坏行不会进入分析，但会在批次详情里保留行号与原因。分析分母始终基于「成功解析的行」。
        </Callout>
      )}

      <Panel
        title="导入文件"
        sub="支持 CSV / JSON；在浏览器本地解析，文件内容不离开本机。"
        pad
      >
        <div
          className={`dropzone ${dragging ? 'drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragging(false);
            await handleFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
        >
          <UploadCloud size={22} />
          <strong style={{ color: 'var(--ink-2)' }}>拖拽 CSV / JSON 文件，或点击选择</strong>
          <span>自动识别来源类型与字段映射；可在批次详情中重新映射。</span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.json,.txt,text/csv,application/json"
            multiple
            hidden
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </Panel>

      <Panel title="批次清单" sub="按类型筛选；点击行查看字段映射、覆盖范围与问题。" pad={false}>
        <div style={{ padding: '0 18px' }}>
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'all', label: '全部', count: counts.all },
              { value: 'readings', label: '室温读数', count: counts.readings ?? 0 },
              { value: 'weather', label: '气象', count: counts.weather ?? 0 },
              { value: 'work_orders', label: '工单', count: counts.work_orders ?? 0 },
              { value: 'complaints', label: '投诉', count: counts.complaints ?? 0 },
              { value: 'registry', label: '登记册', count: counts.registry ?? 0 },
            ]}
          />
        </div>
        {batches.length === 0 ? (
          <Empty icon={<FileSpreadsheet size={26} />} title="还没有导入任何批次">
            点击上方「导入随题样例」载入 7 个样例文件，或拖拽自己的 CSV / JSON。
          </Empty>
        ) : (
          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>文件</th>
                  <th>类型</th>
                  <th>哈希</th>
                  <th style={{ textAlign: 'right' }}>行数</th>
                  <th>到达时间（截止基准）</th>
                  <th>覆盖范围</th>
                  <th>问题</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const meta = KIND_META[b.kind];
                  const problems = b.issues.filter((i) => i.severity !== 'info');
                  return (
                    <tr key={b.id} className="clickable" onClick={() => setDetailId(b.id)}>
                      <td>
                        <div className="row" style={{ gap: 7 }}>
                          {b.fileName.endsWith('.json') ? <Braces size={14} color="var(--ink-4)" /> : <FileSpreadsheet size={14} color="var(--ink-4)" />}
                          <span style={{ fontWeight: 560 }}>{b.fileName}</span>
                        </div>
                        <div className="tiny-2" style={{ marginLeft: 21 }}>{bytes(b.byteSize)}</div>
                      </td>
                      <td>
                        <Chip tone={meta.tone}>{meta.label}</Chip>
                      </td>
                      <td className="mono tiny-2" title={b.fileHash}>
                        {fmtHash(b.fileHash, 12)}
                      </td>
                      <td className="num" style={{ textAlign: 'right' }}>
                        {b.rowCount.toLocaleString()}
                        {b.invalidCount > 0 && (
                          <div className="tiny-2" style={{ color: 'var(--medium)' }}>坏行 {b.invalidCount}</div>
                        )}
                      </td>
                      <td className="tiny">{dateTime(b.ingestedAt)}</td>
                      <td className="tiny">
                        {b.coverage.startTs
                          ? `${dateTime(b.coverage.startTs)} → ${dateTime(b.coverage.endTs)}`
                          : b.kind === 'registry'
                            ? `${b.data.buildings?.length ?? 0} 栋楼`
                            : '—'}
                      </td>
                      <td>
                        {problems.length ? (
                          <Chip tone="medium">{problems.length} 项</Chip>
                        ) : (
                          <Chip tone="low">正常</Chip>
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn ghost sm"
                          title="删除批次"
                          onClick={() => {
                            void store.deleteBatch(b.id);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <BatchDetail batch={detail} onClose={() => setDetailId(null)} />
      <DataDictionary open={dictOpen} onClose={() => setDictOpen(false)} />
    </>
  );
}

function DataDictionary({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="字段说明" sub="各来源的规范字段与常见别名；导入时按文件名与表头自动推断。" onClose={onClose} wide
      footer={<button className="btn" onClick={onClose}>关闭</button>}>
      {(Object.keys(FIELD_SPECS) as SourceKind[]).map((kind) => (
        <div key={kind}>
          <div className="row" style={{ gap: 7, marginBottom: 4 }}>
            <Chip tone={KIND_META[kind].tone}>{KIND_META[kind].label}</Chip>
            <span className="tiny-2">{KIND_META[kind].hint}</span>
          </div>
          <table className="table">
            <thead>
              <tr><th>规范字段</th><th>含义</th><th>必填</th><th>可识别别名</th></tr>
            </thead>
            <tbody>
              {FIELD_SPECS[kind].map((f) => (
                <tr key={f.canonical}>
                  <td className="mono tiny">{f.canonical}</td>
                  <td className="tiny">{f.label}</td>
                  <td>{f.required ? <Chip tone="medium">必填</Chip> : <span className="tiny-2">可选</span>}</td>
                  <td className="tiny-2 mono">{f.alternates.join(' / ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="callout info">
        <Info size={14} color="var(--cool)" />
        <div className="tiny-2">
          缺少必填字段的行会计为「坏行」并保留行号；同一「探头 + 时间」的重复读数会去重并单独计数。
        </div>
      </div>
    </Modal>
  );
}

function MiniStat({ label, value, foot, tone }: { label: string; value: string | number; foot?: string; tone?: string }) {
  return (
    <div className="stat" style={{ ['--tone' as string]: tone ?? 'rgba(255,255,255,0.08)' }}>
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 23 }}>{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}

function BatchDetail({ batch, onClose }: { batch: ImportBatch | null; onClose: () => void }) {
  const state = useStore();
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [kind, setKind] = useState<SourceKind>('readings');
  const [initFor, setInitFor] = useState<string | null>(null);

  if (!batch) return null;
  if (initFor !== batch.id) {
    setInitFor(batch.id);
    setMapping({ ...batch.fieldMapping });
    setKind(batch.kind);
  }

  const headers = Object.keys(batch.data.readings?.[0] ?? batch.data.weather?.[0] ?? { });
  const coverage = batch.coverage;
  const maxDay = coverage.dayCounts.reduce((m, d) => Math.max(m, d.count), 0);

  return (
    <Modal
      open={!!batch}
      wide
      title={batch.fileName}
      sub={`${KIND_META[batch.kind].label} · ${batch.rowCount.toLocaleString()} 行 · ${bytes(batch.byteSize)} · 到达 ${dateTime(batch.ingestedAt)}`}
      onClose={onClose}
      footer={
        <>
          <span className="tiny-2" style={{ marginRight: 'auto' }}>
            重新映射会用同一份原始文件重新解析，并保留到达时间。
          </span>
          <button className="btn" onClick={onClose}>关闭</button>
          <button
            className="btn primary"
            onClick={async () => {
              await store.remapBatch(batch.id, kind, mapping);
              onClose();
            }}
          >
            <RefreshCcw size={13} />
            按当前映射重新解析
          </button>
        </>
      }
    >
      <div className="grid c2">
        <div>
          <h4 className="tiny-2" style={{ letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>
            <Hash size={11} style={{ verticalAlign: -1 }} /> 来源标识
          </h4>
          <dl className="kv">
            <dt>SHA-256</dt>
            <dd className="mono" style={{ fontSize: 10.5, wordBreak: 'break-all' }}>{batch.fileHash}</dd>
            <dt>解析器</dt>
            <dd className="mono">{batch.parserVersion}</dd>
            <dt>导入时间</dt>
            <dd>{dateTime(batch.importedAt)}</dd>
            <dt>到达时间</dt>
            <dd>
              {dateTime(batch.ingestedAt)}
              <div className="tiny-2">运行截止以此为基准；迟到数据不会回写历史运行。</div>
            </dd>
          </dl>
        </div>
        <div>
          <h4 className="tiny-2" style={{ letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>
            <CalendarRange size={11} style={{ verticalAlign: -1 }} /> 覆盖范围
          </h4>
          <dl className="kv">
            <dt>时间范围</dt>
            <dd>{coverage.startTs ? `${dateTime(coverage.startTs)} → ${dateTime(coverage.endTs)}` : '不适用'}</dd>
            <dt>探头</dt>
            <dd>{coverage.sensorIds.length ? coverage.sensorIds.join('、') : '—'}</dd>
            <dt>涉及楼栋</dt>
            <dd>{coverage.buildingIds.length ? coverage.buildingIds.join('、') : '—'}</dd>
            <dt>供热日</dt>
            <dd>{coverage.dayCounts.length} 天</dd>
          </dl>
          {coverage.dayCounts.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="tiny-2" style={{ marginBottom: 4 }}>每日行数分布</div>
              <div className="row" style={{ gap: 2, alignItems: 'flex-end', height: 34 }}>
                {coverage.dayCounts.map((d) => (
                  <div
                    key={d.dayKey}
                    title={`${d.dayKey} · ${d.count} 行`}
                    style={{
                      flex: 1,
                      minWidth: 3,
                      height: `${Math.max(8, (d.count / Math.max(1, maxDay)) * 100)}%`,
                      background: 'var(--teal)',
                      opacity: 0.7,
                      borderRadius: 1,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <h4 className="tiny-2" style={{ letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>
          <Columns3 size={11} style={{ verticalAlign: -1 }} /> 字段解释
        </h4>
        <div className="callout info" style={{ marginBottom: 10 }}>
          把文件列映射到规范字段。缺必备字段会导致行被计为坏行。
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {Object.entries(mapping).map(([canonical, source]) => (
            <div key={canonical} className="row" style={{ gap: 8 }}>
              <span className="mono tiny" style={{ width: 155, color: 'var(--ink-3)' }}>{canonical}</span>
              <select
                value={source ?? ''}
                onChange={(e) => setMapping({ ...mapping, [canonical]: e.target.value || null })}
                style={{ flex: 1 }}
              >
                <option value="">（不使用）</option>
                {[...new Set([source, ...headers].filter(Boolean))].map((h) => (
                  <option key={h} value={h!}>{h}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="tiny-2">来源类型</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as SourceKind)} style={{ width: 160 }}>
            {(Object.keys(KIND_META) as SourceKind[]).map((k) => (
              <option key={k} value={k}>{KIND_META[k].label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <h4 className="tiny-2" style={{ letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>
          <CheckCircle2 size={11} style={{ verticalAlign: -1 }} /> 解析结果与问题
        </h4>
        <div className="row wrap" style={{ gap: 6, marginBottom: 8 }}>
          <Chip tone="low">有效行 {batch.rowCount - batch.invalidCount}</Chip>
          {batch.invalidCount > 0 && <Chip tone="medium">坏行 {batch.invalidCount}</Chip>}
          {batch.duplicateCount > 0 && <Chip tone="cool">去重 {batch.duplicateCount}</Chip>}
        </div>
        {batch.issues.length === 0 ? (
          <div className="tiny muted">未发现问题。</div>
        ) : (
          <div className="stack" style={{ gap: 7 }}>
            {batch.issues.map((i) => (
              <div key={i.code} className={`callout ${i.severity === 'error' ? 'danger' : i.severity === 'warn' ? 'warn' : 'info'}`} style={{ padding: '8px 11px' }}>
                <div>
                  <strong style={{ fontSize: 12 }}>{i.message}</strong>
                  <span className="tiny-2" style={{ marginLeft: 6 }}>× {i.count}</span>
                  {i.samples?.length ? <div className="tiny-2 mono" style={{ marginTop: 2 }}>{i.samples.join(' · ')}</div> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {batch.textPreview?.length ? (
        <div>
          <h4 className="tiny-2" style={{ letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>原始行预览</h4>
          <div style={{ overflowX: 'auto', border: '1px solid var(--line-soft)', borderRadius: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  {Object.keys(batch.textPreview[0]).map((h) => <th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {batch.textPreview.map((row, i) => (
                  <tr key={i}>
                    {Object.keys(batch.textPreview![0]).map((h) => (
                      <td key={h} className="mono" style={{ fontSize: 10.5, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row[h]}>
                        {row[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tiny-2" style={{ marginTop: 4 }}>前 {batch.textPreview.length} 行，原样展示，用于核对字段解释是否正确。</div>
        </div>
      ) : null}

      {batch.data.buildings?.length ? (
        <div>
          <h4 className="tiny-2" style={{ letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>登记册内容</h4>
          <div className="tiny muted">
            {batch.data.buildings.length} 栋楼、{batch.data.probes?.length ?? 0} 个探头；导入后已合并进当前登记册，可在「楼栋映射」中修订。
          </div>
        </div>
      ) : null}

      <div className="tiny-2">
        存储占用：本地 IndexedDB。当前工作区共 {state.batches.length} 个批次、{bytes(state.storage.usage)}。
        {coverage.startTs ? ` 覆盖率基准按供热日（06:00 起）统计。` : ''}
      </div>
    </Modal>
  );
}
