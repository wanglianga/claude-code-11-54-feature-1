import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Building2, GitMerge, MapPin, Pencil, Plus, Radio, ShieldQuestion, Split, ArrowRight, History } from 'lucide-react';
import { store, useStore, useActiveMapping } from '../state/store';
import type { AddressAssertion, ComplaintCandidate, MappingVersion, Probe } from '../types';
import { Callout, Chip, Empty, Modal, Panel, Stat } from '../components/ui/primitives';
import { PageHead } from '../components/Layout';
import { addressKey, candidateDifference, findAssertionConflicts } from '../lib/address';
import { dateTime } from '../lib/format';

export function MappingPage() {
  const state = useStore();
  const mapping = useActiveMapping();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ buildings: MappingVersion['buildings']; probes: Probe[]; note: string } | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const activeAssertions = state.assertions.filter((a) => !a.superseded);
  const conflicts = findAssertionConflicts(state.assertions);

  const unassigned = useMemo(() => {
    const latest = state.runs[0];
    if (!latest) return [];
    // Addresses already handled by an active assertion should not be re-prompted.
    const handled = new Set(
      state.assertions.filter((a) => !a.superseded).map((a) => a.addressKey),
    );
    return latest.result.complaints.filter(
      (c) => c.status === 'unassigned' && !handled.has(addressKey(c.rawAddress)),
    );
  }, [state.runs, state.assertions]);

  function openEditor() {
    if (!mapping) return;
    setDraft({
      buildings: mapping.buildings.map((b) => ({ ...b })),
      probes: mapping.probes.map((p) => ({ ...p })),
      note: '',
    });
    setEditing(true);
  }

  return (
    <>
      <PageHead
        title="楼栋映射"
        lede="维护楼栋别名、探头安装位置和投诉地址归属。登记册版本化保存：已完成运行引用当时的快照；修订后新运行会显示受影响的投诉与风险变化。"
        actions={
          <>
            <Link to="/runs" className="btn">
              查看运行差异 <ArrowRight size={13} />
            </Link>
            <button className="btn" onClick={() => setManualOpen(true)} disabled={!mapping}>
              <Plus size={13} />
              新增地址判断
            </button>
            <button className="btn primary" onClick={openEditor} disabled={!mapping}>
              <Pencil size={13} />
              修订登记册
            </button>
          </>
        }
      />

      <div className="grid c4">
        <Stat label="当前登记册" value={mapping ? `v${mapping.version}` : '—'} foot={mapping ? mapping.note : '尚未导入'} tone="var(--teal)" icon={<Building2 size={13} color="var(--teal)" />} />
        <Stat label="楼栋 / 探头" value={`${mapping?.buildings.length ?? 0} / ${mapping?.probes.length ?? 0}`} foot="探头缺失的楼栋会被标为盲区" icon={<Radio size={13} />} />
        <Stat label="人工确认地址" value={activeAssertions.length} foot={conflicts.length ? `${conflicts.length} 处冲突待处理` : '无待处理冲突'} tone={conflicts.length ? 'var(--medium)' : undefined} icon={<MapPin size={13} color="var(--medium)" />} />
        <Stat label="未归属投诉" value={unassigned.length} foot="来自最新运行；可在下方逐条确认" tone={unassigned.length ? 'var(--cool)' : undefined} icon={<ShieldQuestion size={13} color="var(--cool)" />} />
      </div>

      {conflicts.length > 0 && (
        <Callout tone="warn" icon={<AlertTriangle size={16} color="var(--medium)" />}>
          <strong>{conflicts.length} 处地址在不同分析窗口被归到了不同楼栋。</strong> 保存前需要选择保留一方、采用另一方或合并候选，系统不会用最后一次写入静默覆盖另一份判断。
          <div style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => setConflictOpen(true)}>
              <GitMerge size={12} />
              处理冲突
            </button>
          </div>
        </Callout>
      )}

      <div className="grid c2">
        <Panel title="楼栋登记" sub={`${mapping?.buildings.length ?? 0} 栋 · 别名用于投诉地址匹配`}>
          {mapping?.buildings.length ? (
            <div className="stack" style={{ gap: 10 }}>
              {mapping.buildings.map((b) => {
                const probes = mapping.probes.filter((p) => p.buildingId === b.id);
                return (
                  <div key={b.id} style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--line-soft)' }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="mono tiny-2">{b.id}</span>
                      <strong style={{ fontSize: 13 }}>{b.name}</strong>
                      <span className="tiny-2">{b.complex}</span>
                      <div className="spacer" />
                      <Chip tone={probes.length ? 'teal' : 'undetermined'}>
                        {probes.length ? `${probes.length} 探头` : '无探头'}
                      </Chip>
                    </div>
                    <div className="tiny-2" style={{ marginTop: 3 }}>{b.addressNote}</div>
                    <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
                      {b.aliases.length === 0 && <span className="tiny-2">（无别名）</span>}
                      {b.aliases.map((a) => (
                        <span key={a} className="chip mono" style={{ fontSize: 9.5 }}>{a}</span>
                      ))}
                    </div>
                    {probes.length > 0 && (
                      <div className="stack" style={{ gap: 3, marginTop: 7 }}>
                        {probes.map((p) => (
                          <div key={p.id} className="row tiny-2" style={{ gap: 6 }}>
                            <Radio size={10} />
                            <span className="mono">{p.id}</span>
                            <span>{p.label}</span>
                            <span className="spacer" />
                            <span>{p.intervalMin} min</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty title="登记册为空">请先在「来源登记」导入 registry.json 或随题样例。</Empty>
          )}
        </Panel>

        <div className="stack">
          <Panel
            title="人工确认的地址归属"
            sub="人工确认优先于自动匹配；已完成的运行仍使用当时的判断。"
            actions={
              <button className="btn sm" onClick={() => setAddressOpen(true)} disabled={!unassigned.length}>
                <Plus size={12} />
                从最新运行确认
              </button>
            }
          >
            {activeAssertions.length === 0 ? (
              <div className="tiny muted">暂无人确认记录。未归属投诉会在下方列出，确认后新运行生效。</div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {activeAssertions.map((a) => (
                  <div key={a.id} style={{ padding: '9px 11px', borderRadius: 9, border: '1px solid var(--line-soft)', background: 'rgba(255,255,255,0.02)' }}>
                    <div className="row" style={{ gap: 6 }}>
                      <span style={{ fontWeight: 560, fontSize: 12.5 }}>{a.rawAddressSamples[0]}</span>
                      <div className="spacer" />
                      <Chip tone={a.resolution?.type === 'merge' ? 'cool' : 'teal'}>
                        {a.resolution?.type === 'merge' ? '合并归属' : a.chosenBuildingIds.length > 1 ? '多楼栋' : '唯一归属'}
                      </Chip>
                    </div>
                    <div className="row wrap tiny-2" style={{ gap: 4, marginTop: 5 }}>
                      <ArrowRight size={10} />
                      {a.chosenBuildingIds.map((id) => (
                        <span key={id} className="chip mono" style={{ fontSize: 9.5 }}>{id}</span>
                      ))}
                      <span style={{ marginLeft: 4 }}>{a.note}</span>
                    </div>
                    <div className="row" style={{ marginTop: 3 }}>
                      <span className="tiny-2">{a.windowLabel} · 确认于 {dateTime(a.createdAt)}</span>
                      <div className="spacer" />
                      <button
                        className="btn ghost sm"
                        title="撤销这次人工确认（历史运行不受影响）"
                        onClick={async () => {
                          if (!window.confirm('撤销这次人工确认？已完成运行仍保留原判断，新运行会重新按自动匹配处理。')) return;
                          await store.revokeAssertion(a.id);
                        }}
                      >
                        撤销
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="未归属投诉（最新运行）" sub="地址无法唯一归属到楼栋；保留未归属，避免误判。">
            {unassigned.length === 0 ? (
              <div className="tiny muted">最新运行中没有未归属投诉。</div>
            ) : (
              <div className="stack" style={{ gap: 12 }}>
                {unassigned.map((c) => (
                  <AddressResolver key={c.complaintId} complaint={c} />
                ))}
              </div>
            )}
          </Panel>

          <Panel title="登记册历史" sub="每个版本都保留；在运行中可回查当时使用的版本。">
            {state.mappings.length <= 1 ? (
              <div className="tiny muted">当前只有 v1。</div>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {[...state.mappings].reverse().map((m) => (
                  <div key={m.id} className="row" style={{ gap: 8 }}>
                    <History size={12} color="var(--ink-4)" />
                    <span className="mono tiny">v{m.version}</span>
                    <span className="tiny">{m.note}</span>
                    <span className="tiny-2">{dateTime(m.createdAt)}</span>
                    <div className="spacer" />
                    {m.id === state.activeMappingId ? (
                      <Chip tone="teal">当前</Chip>
                    ) : (
                      <button className="btn ghost sm" onClick={() => store.restoreMapping(m.id)}>
                        基于此版本新建
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {draft && mapping && (
        <MappingEditor
          open={editing}
          draft={draft}
          onChange={setDraft}
          onClose={() => setEditing(false)}
          onSave={async () => {
            try {
              await store.saveMapping(draft.buildings, draft.probes, draft.note || `修订登记册 v${mapping.version + 1}`);
              setEditing(false);
            } catch {
              // Toast already explains what needs fixing; keep the editor open.
            }
          }}
        />
      )}

      <ConflictModal open={conflictOpen} onClose={() => setConflictOpen(false)} conflicts={conflicts} />

      <ManualAssertionModal open={manualOpen} onClose={() => setManualOpen(false)} />

      <Modal
        open={addressOpen}
        title="从最新运行确认未归属地址"
        sub="为未归属投诉选择目标楼栋；保存后产生新的地址判断，仅影响后续运行。"
        onClose={() => setAddressOpen(false)}
        footer={<button className="btn" onClick={() => setAddressOpen(false)}>关闭</button>}
      >
        {unassigned.map((c) => (
          <AddressResolver key={c.complaintId} complaint={c} expanded />
        ))}
      </Modal>
    </>
  );
}

function MappingEditor({
  open,
  draft,
  onChange,
  onClose,
  onSave,
}: {
  open: boolean;
  draft: { buildings: MappingVersion['buildings']; probes: Probe[]; note: string };
  onChange: (d: typeof draft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Modal
      open={open}
      title="修订登记册"
      sub="保存后生成新版本。修订会改变探头归属与地址匹配，新运行中会显示受影响的投诉和风险变化。"
      onClose={onClose}
      wide
      footer={
        <>
          <input
            type="text"
            placeholder="修订说明（必填，例如：核实 3 号楼探头挪到 5 号楼）"
            value={draft.note}
            onChange={(e) => onChange({ ...draft, note: e.target.value })}
            style={{ flex: 1 }}
          />
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={onSave} disabled={!draft.note.trim()}>
            保存为新版本
          </button>
        </>
      }
    >
      <div className="callout info">
        探头安装位置决定后续读数归属哪栋楼。修改前请确认现场确实发生过调整，而不是为迎合结论。
      </div>
      <h4 className="tiny-2" style={{ letterSpacing: '0.1em', textTransform: 'uppercase' }}>楼栋与别名</h4>
      <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--line-soft)', borderRadius: 9 }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>编号</th>
              <th style={{ width: 110 }}>名称</th>
              <th style={{ width: 120 }}>小区</th>
              <th>地址别名（用 | 分隔）</th>
            </tr>
          </thead>
          <tbody>
            {draft.buildings.map((b, idx) => (
              <tr key={`${b.id}-${idx}`}>
                <td>
                  <input
                    type="text"
                    value={b.id}
                    onChange={(e) => {
                      const next = [...draft.buildings];
                      next[idx] = { ...b, id: e.target.value };
                      onChange({ ...draft, buildings: next });
                    }}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={b.name}
                    onChange={(e) => {
                      const next = [...draft.buildings];
                      next[idx] = { ...b, name: e.target.value };
                      onChange({ ...draft, buildings: next });
                    }}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={b.complex}
                    onChange={(e) => {
                      const next = [...draft.buildings];
                      next[idx] = { ...b, complex: e.target.value };
                      onChange({ ...draft, buildings: next });
                    }}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={b.aliases.join('|')}
                    onChange={(e) => {
                      const next = [...draft.buildings];
                      next[idx] = { ...b, aliases: e.target.value.split('|').filter(Boolean) };
                      onChange({ ...draft, buildings: next });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 className="tiny-2" style={{ letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 8 }}>探头安装位置</h4>
      <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--line-soft)', borderRadius: 9 }}>
      <table className="table">
        <thead>
          <tr><th>探头</th><th>标签</th><th>所属楼栋</th><th>间隔</th><th>位置说明</th></tr>
        </thead>
        <tbody>
          {draft.probes.map((p, idx) => (
            <tr key={p.id}>
              <td className="mono tiny">{p.id}</td>
              <td><input type="text" value={p.label} onChange={(e) => {
                const next = [...draft.probes];
                next[idx] = { ...p, label: e.target.value };
                onChange({ ...draft, probes: next });
              }} /></td>
              <td>
                <select value={p.buildingId} onChange={(e) => {
                  const next = [...draft.probes];
                  next[idx] = { ...p, buildingId: e.target.value };
                  onChange({ ...draft, probes: next });
                }}>
                  {draft.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </td>
              <td>
                <input type="number" value={p.intervalMin} style={{ width: 70 }} onChange={(e) => {
                  const next = [...draft.probes];
                  next[idx] = { ...p, intervalMin: Number(e.target.value) || 15 };
                  onChange({ ...draft, probes: next });
                }} />
              </td>
              <td><input type="text" value={p.locationNote} onChange={(e) => {
                const next = [...draft.probes];
                next[idx] = { ...p, locationNote: e.target.value };
                onChange({ ...draft, probes: next });
              }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </Modal>
  );
}

function AddressResolver({ complaint, expanded = false }: { complaint: import('../types').ComplaintResult; expanded?: boolean }) {
  const state = useStore();
  const [chosen, setChosen] = useState<string[]>(complaint.candidates.map((c) => c.buildingId));
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(expanded);
  const [pendingConflict, setPendingConflict] = useState<AddressAssertion[] | null>(null);

  const candidates: ComplaintCandidate[] =
    complaint.candidates.length > 0
      ? complaint.candidates
      : state.mappings.at(-1)?.buildings.map((b) => ({ buildingId: b.id, score: 0, reason: '手工指定' })) ?? [];

  async function save(resolution?: 'keep_existing' | 'adopt_new' | 'merge', conflicts: AddressAssertion[] = []) {
    if (!chosen.length || !note.trim()) return;
    if (resolution && conflicts.length) {
      const existing = conflicts.flatMap((a) => a.chosenBuildingIds);
      const finalIds =
        resolution === 'keep_existing'
          ? [...new Set(existing)]
          : resolution === 'merge'
            ? [...new Set([...existing, ...chosen])]
            : chosen;
      await store.resolveConflict(conflicts, resolution, finalIds, note);
      setPendingConflict(null);
      setNote('');
      setOpen(false);
      return;
    }
    const conflictsNow = store.assertionConflictsFor(complaint.rawAddress, chosen);
    if (conflictsNow.length > 0) {
      setPendingConflict(conflictsNow);
      return;
    }
    await store.addAssertion({
      rawAddress: complaint.rawAddress,
      chosenBuildingIds: chosen,
      candidates: complaint.candidates,
      note,
      runId: complaint.complaintId,
      windowLabel: complaint.dayKeys.join(','),
      resolution:
        chosen.length > 1
          ? { type: 'merge', conflictWith: [], reason: note, resolvedAt: Date.now() }
          : undefined,
    });
    setNote('');
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 560 }}>{complaint.complaintId} · {complaint.rawAddress}</div>
          <div className="tiny-2">{complaint.text}</div>
          <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
            {complaint.candidates.map((c) => (
              <Chip key={c.buildingId} tone="cool" mono>{c.buildingId} {c.score.toFixed(2)}</Chip>
            ))}
          </div>
        </div>
        <button className="btn sm" onClick={() => setOpen(true)}>
          <Split size={12} />
          确认归属
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line-soft)', background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ fontSize: 12.5, fontWeight: 560 }}>{complaint.complaintId} · {complaint.rawAddress}</div>
      <div className="tiny-2" style={{ marginBottom: 8 }}>{complaint.text}</div>
      <div className="tiny-2" style={{ marginBottom: 4 }}>选择楼栋（可多选表示「合并归属」）：</div>
      <div className="row wrap" style={{ gap: 6 }}>
        {candidates.map((c) => {
          const on = chosen.includes(c.buildingId);
          return (
            <button
              key={c.buildingId}
              className={`chip ${on ? 'accent' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setChosen(chosen.includes(c.buildingId) ? chosen.filter((x) => x !== c.buildingId) : [...chosen, c.buildingId])}
              title={c.reason}
            >
              <span className="mono">{c.buildingId}</span>
              {c.score > 0 ? ` ${(c.score * 100).toFixed(0)}分` : ''}
            </button>
          );
        })}
      </div>
      {candidates.length === 0 && <div className="tiny-2">没有可用候选，请先在登记册里添加楼栋。</div>}
      <textarea
        placeholder="确认依据（例如：电话回访确认 8 号楼 3 单元；两栋楼共用立管，按合并处理）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ marginTop: 8 }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <span className="tiny-2">保存后作为人工确认，只影响未来运行。</span>
        <div className="spacer" />
        <button className="btn primary sm" disabled={!chosen.length || !note.trim()} onClick={() => save()}>
          保存人工确认
        </button>
      </div>

      {pendingConflict && (
        <div style={{ marginTop: 10, padding: '10px 11px', borderRadius: 9, border: '1px solid rgba(224,168,74,0.35)', background: 'rgba(224,168,74,0.06)' }}>
          <div className="row" style={{ gap: 6 }}>
            <AlertTriangle size={13} color="var(--medium)" />
            <strong style={{ fontSize: 12 }}>该地址已有不同的归属判断</strong>
          </div>
          <div className="tiny-2" style={{ marginTop: 4 }}>
            现有：
            {pendingConflict.map((a) => (
              <span key={a.id} className="mono" style={{ marginLeft: 4 }}>{a.chosenBuildingIds.join('+')}（{a.windowLabel || '未标注窗口'}）</span>
            ))}
            ；本次选择：<span className="mono">{chosen.join('+')}</span>。
          </div>
          <div className="tiny-2" style={{ marginTop: 4 }}>
            不能直接用本次判断覆盖旧判断，请选择处理方式（说明已填写）：
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            <button className="btn sm" onClick={() => save('adopt_new', pendingConflict)}>采用本次判断</button>
            <button className="btn sm" onClick={() => save('keep_existing', pendingConflict)}>保留原有判断</button>
            <button className="btn sm" onClick={() => save('merge', pendingConflict)}>合并两方候选</button>
            <button className="btn ghost sm" onClick={() => setPendingConflict(null)}>返回修改</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ManualAssertionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mapping = useActiveMapping();
  const [address, setAddress] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [conflicts, setConflicts] = useState<AddressAssertion[] | null>(null);

  const buildings = mapping?.buildings ?? [];

  async function persist(finalIds: string[], decision?: 'adopt_new' | 'merge' | 'keep_existing') {
    if (!address.trim() || !finalIds.length || !note.trim()) return;
    if (decision && conflicts?.length) {
      await store.resolveConflict(conflicts, decision, finalIds, note);
    } else {
      await store.addAssertion({
        rawAddress: address,
        chosenBuildingIds: finalIds,
        candidates: [],
        note,
        windowLabel: `${mapping?.note ?? ''}`,
        resolution:
          finalIds.length > 1
            ? { type: 'merge', conflictWith: [], reason: note, resolvedAt: Date.now() }
            : undefined,
      });
    }
    setConflicts(null);
    setAddress('');
    setChosen([]);
    setNote('');
    onClose();
  }

  return (
    <Modal
      open={open}
      title="新增地址判断"
      sub="为模糊或新出现的投诉地址建立人工归属；保存前会检查是否与已有判断冲突。"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button
            className="btn primary"
            disabled={!address.trim() || !chosen.length || !note.trim()}
            onClick={() => {
              const found = store.assertionConflictsFor(address, chosen);
              if (found.length) setConflicts(found);
              else void persist(chosen);
            }}
          >
            保存判断
          </button>
        </>
      }
    >
      <div className="field">
        <label>投诉地址原文</label>
        <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="例如：北岸新城8号楼、12号楼附近" />
      </div>
      <div className="field">
        <label>归属楼栋（可多选 = 合并归属）</label>
        <div className="row wrap" style={{ gap: 6 }}>
          {buildings.map((b) => {
            const on = chosen.includes(b.id);
            return (
              <button
                key={b.id}
                className={`chip ${on ? 'accent' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => setChosen(on ? chosen.filter((x) => x !== b.id) : [...chosen, b.id])}
              >
                <span className="mono">{b.id}</span> {b.name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="field">
        <label>判断依据</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：电话回访确认为 8 号楼；或两栋楼共用立管，按合并处理。" />
      </div>
      {conflicts && (
        <div className="callout warn">
          <div>
            <strong>发现 {conflicts.length} 份不同的历史判断。</strong>
            <div className="tiny-2" style={{ marginTop: 4 }}>
              {conflicts.map((a) => (
                <div key={a.id}>
                  {a.chosenBuildingIds.join('+')} · {a.windowLabel || '未标注窗口'} · {a.note}
                </div>
              ))}
            </div>
            <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
              <button className="btn sm" onClick={() => persist(chosen, 'adopt_new')}>采用本次</button>
              <button className="btn sm" onClick={() => persist([...new Set(conflicts.flatMap((a) => a.chosenBuildingIds))], 'keep_existing')}>保留原有</button>
              <button className="btn sm" onClick={() => persist([...new Set([...chosen, ...conflicts.flatMap((a) => a.chosenBuildingIds)])], 'merge')}>合并</button>
              <button className="btn ghost sm" onClick={() => setConflicts(null)}>返回修改</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ConflictModal({
  open,
  onClose,
  conflicts,
}: {
  open: boolean;
  onClose: () => void;
  conflicts: ReturnType<typeof store.conflicts>;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<Record<string, 'keep_existing' | 'adopt_new' | 'merge'>>({});
  if (!open) return null;
  return (
    <Modal
      open={open}
      title="保存前的地址归属冲突"
      sub="同一地址在不同分析窗口被选择为不同楼栋。必须明确保留一方或合并，不能以最后一次写入覆盖另一份判断。"
      onClose={onClose}
      wide
      footer={<button className="btn" onClick={onClose}>稍后处理</button>}
    >
      {conflicts.map((c) => {
        const [a, b] = c.assertions;
        const diff = candidateDifference(a, b);
        const decision = decisions[c.addressKey] ?? 'merge';
        const mergeIds = [...new Set([...a.chosenBuildingIds, ...b.chosenBuildingIds])];
        const finalIds =
          decision === 'keep_existing' ? b.chosenBuildingIds : decision === 'adopt_new' ? a.chosenBuildingIds : mergeIds;
        const note = notes[c.addressKey] ?? '';
        const ready = note.trim().length > 0;
        return (
          <div key={c.addressKey} className="panel" style={{ padding: 14 }}>
            <div className="row" style={{ gap: 8 }}>
              <AlertTriangle size={15} color="var(--medium)" />
              <strong style={{ fontSize: 13 }}>{c.sample}</strong>
              <div className="spacer" />
              <Chip tone="medium">{c.assertions.length} 份判断</Chip>
            </div>
            <div className="grid c2" style={{ marginTop: 10 }}>
              {[a, b].map((x, i) => (
                <div key={x.id} style={{ padding: '9px 11px', borderRadius: 9, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line-soft)' }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="tiny-2">{i === 0 ? '较新的判断' : '较早的判断'}</span>
                    <div className="spacer" />
                    <span className="tiny-2 mono">{dateTime(x.createdAt)}</span>
                  </div>
                  <div className="row wrap" style={{ gap: 4, marginTop: 5 }}>
                    {x.chosenBuildingIds.map((id) => <span key={id} className="chip mono" style={{ fontSize: 9.5 }}>{id}</span>)}
                  </div>
                  <div className="tiny-2" style={{ marginTop: 5 }}>{x.note}</div>
                  <div className="tiny-2">窗口 {x.windowLabel || '未标注'}</div>
                </div>
              ))}
            </div>
            <div className="tiny-2" style={{ marginTop: 8 }}>
              差异：{diff.onlyA.length ? `较新独有 ${diff.onlyA.join('、')}` : '—'}；{diff.onlyB.length ? `较早独有 ${diff.onlyB.join('、')}` : '—'}；共有 {diff.shared.length ? diff.shared.join('、') : '—'}
            </div>
            <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
              {([
                ['keep_existing', `保留较早判断（${b.chosenBuildingIds.join('+')}）`],
                ['adopt_new', `采用较新判断（${a.chosenBuildingIds.join('+')}）`],
                ['merge', `合并候选（${mergeIds.join('+')}）`],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={`chip ${decision === value ? 'accent' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setDecisions({ ...decisions, [c.addressKey]: value })}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <input
                type="text"
                placeholder="处理说明（必填）：例如按现场回访确认 12 号楼"
                value={note}
                onChange={(e) => setNotes({ ...notes, [c.addressKey]: e.target.value })}
                style={{ flex: 1 }}
              />
              <button
                className="btn primary sm"
                disabled={!ready}
                onClick={async () => {
                  await store.resolveConflict(c.assertions, decision, finalIds, note);
                  onClose();
                }}
              >
                保存处理结果
              </button>
            </div>
          </div>
        );
      })}
    </Modal>
  );
}
