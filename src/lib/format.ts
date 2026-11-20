/** Presentation helpers shared across pages. */
import type { ComplaintStatus, DayClass, RiskLevel, WorkOrderKind } from '../types';
import { fmtLocal, fmtLocalFull } from './time';

export const DAY_CLASS_META: Record<DayClass, { label: string; short: string; color: string; text: string; desc: string }> = {
  normal: {
    label: '正常',
    short: '正常',
    color: 'rgba(111, 191, 143, 0.28)',
    text: '#9ed9b8',
    desc: '覆盖达标，未出现持续低温事件。',
  },
  transient_disturbance: {
    label: '短时扰动',
    short: '短时',
    color: 'rgba(106, 169, 233, 0.34)',
    text: '#a9cdf4',
    desc: '短时、局部下降，通常来自开窗或探头周边扰动，不作为停供证据。',
  },
  local_equipment: {
    label: '局部设备问题',
    short: '局部',
    color: 'rgba(224, 168, 74, 0.4)',
    text: '#f2c37e',
    desc: '单个探头或部分单元偏低，其余正常，指向立管/阀门/住户侧问题。',
  },
  supply_shortfall: {
    label: '供热不足',
    short: '不足',
    color: 'rgba(229, 100, 92, 0.5)',
    text: '#ff9d96',
    desc: '持续低温且覆盖多数探头，属整栋供热不足。',
  },
  insufficient_coverage: {
    label: '覆盖不足',
    short: '覆盖',
    color: 'rgba(156, 143, 208, 0.3)',
    text: '#c3b7ef',
    desc: '探头缺失或读数中断，无法判断当日供热是否充足。',
  },
  unreliable_alignment: {
    label: '对齐不可靠',
    short: '对齐',
    color: 'rgba(156, 143, 208, 0.42)',
    text: '#c3b7ef',
    desc: '监测与工单互相矛盾，或证据形态不足以归类。',
  },
};

export const RISK_META: Record<RiskLevel, { label: string; tone: string }> = {
  high: { label: '高风险', tone: 'high' },
  medium: { label: '中等风险', tone: 'medium' },
  low: { label: '低风险', tone: 'low' },
  undetermined: { label: '无法判断', tone: 'undetermined' },
};

export const STATUS_META: Record<ComplaintStatus, { label: string; tone: string; desc: string }> = {
  supported: { label: '有据可查', tone: 'high', desc: '监测与工单共同支持投诉描述。' },
  partial: { label: '部分支持', tone: 'medium', desc: '仅局部或短时证据，能解释部分体感但不能认定整栋不足。' },
  contradicted: { label: '未获支持', tone: 'low', desc: '投诉时段读数达标，监测不支持投诉描述。' },
  misaligned: { label: '无法对齐', tone: 'undetermined', desc: '工单与监测互相矛盾，现有资料无法可靠对齐。' },
  unverifiable: { label: '无法核实', tone: 'undetermined', desc: '缺少探头或覆盖不足，不能下结论。' },
  unassigned: { label: '未归属', tone: 'cool', desc: '地址无法唯一定位到楼栋。' },
};

export const ORDER_META: Record<WorkOrderKind, { label: string; tone: string }> = {
  supply_suspension: { label: '停供', tone: 'high' },
  valve_adjustment: { label: '阀门调整', tone: 'medium' },
  maintenance: { label: '检修维护', tone: 'cool' },
  complaint_visit: { label: '上门处理', tone: 'teal' },
  other: { label: '其他', tone: 'muted' },
};

export const EPISODE_META = {
  transient: { label: '短时扰动', tone: 'cool' },
  local_equipment: { label: '局部设备', tone: 'medium' },
  supply_shortfall: { label: '持续不足', tone: 'high' },
  unclassified: { label: '待归类', tone: 'undetermined' },
} as const;

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtScore(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Math.round(v).toString();
}

export function fmtHash(hash: string, len = 10): string {
  if (!hash) return '—';
  return hash.length > len ? `${hash.slice(0, len)}…` : hash;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * All timestamps render in the analysis timezone (UTC+8), not the viewer's local
 * timezone — otherwise the same instant reads differently in the header and in
 * engine-generated text.
 */
export function dateTime(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return '—';
  return fmtLocalFull(ts);
}

export function dateOnly(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return '—';
  return fmtLocalFull(ts).slice(0, 10);
}

/** Compact clock label used in chips ("01-20 18:56"). */
export function dateTimeShort(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return '—';
  return fmtLocal(ts);
}

export function riskPriority(r: RiskLevel): number {
  return { high: 0, medium: 1, undetermined: 2, low: 3 }[r];
}

export function riskScoreTone(score: number | null): string {
  if (score === null) return 'var(--unknown)';
  if (score >= 65) return 'var(--high)';
  if (score >= 40) return 'var(--medium)';
  return 'var(--low)';
}

export function dayClassRank(c: DayClass): number {
  return { supply_shortfall: 0, local_equipment: 1, unreliable_alignment: 2, insufficient_coverage: 2, transient_disturbance: 3, normal: 4 }[c];
}

export function complaintStatusTone(s: ComplaintStatus): string {
  return STATUS_META[s].tone;
}

export function download(name: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
