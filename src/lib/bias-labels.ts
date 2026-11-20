/** 展示标签：偏差门控、朝向、墙体、房间、生命周期事件的中文字典。 */
import type {
  BiasGateCode,
  CalibrationStatus,
  ProbeLifecycleKind,
  ProbeOrientation,
  RoomType,
  WallPosition,
} from '../types';

export const ORIENTATION_LABELS: Record<ProbeOrientation, string> = {
  north: '北向',
  south: '南向',
  east: '东向',
  west: '西向',
  interior: '内区',
  unknown: '未知',
};

export const WALL_LABELS: Record<WallPosition, string> = {
  external_wall: '外墙',
  internal_wall: '内墙',
  interior: '内区',
  unknown: '未知',
};

export const ROOM_LABELS: Record<RoomType, string> = {
  living_room: '客厅',
  bedroom: '卧室',
  kitchen: '厨房',
  stairwell: '楼梯间',
  other: '其他',
  unknown: '未知',
};

export const CALIBRATION_LABELS: Record<CalibrationStatus, { label: string; tone: string }> = {
  valid: { label: '有效', tone: 'low' },
  expired: { label: '已过期', tone: 'high' },
  missing: { label: '缺失', tone: 'undetermined' },
  conflict: { label: '冲突', tone: 'medium' },
};

export const LIFECYCLE_LABELS: Record<ProbeLifecycleKind, string> = {
  installed: '安装',
  replaced: '探头更换',
  relocated: '迁移',
  external_wall_works: '外墙改造',
  recalibrated: '重新校准',
  removed: '拆除/停用',
};

export const GATE_LABELS: Record<BiasGateCode, string> = {
  ok: '门控通过',
  missing_position_evidence: '缺少位置证据',
  missing_certificate: '缺少校准证书',
  certificate_expired: '证书过期/无有效期',
  certificate_conflict: '证书证据冲突',
  insufficient_neighbors: '无可比邻近探头',
  insufficient_comparable_days: '可比日不足/方向不稳',
  persistent_delta_below_threshold: '偏差低于证据下限',
  sparse_layout: '布局稀疏',
  model_not_applicable: '模型不适用',
};

export const GATE_TONES: Record<BiasGateCode, string> = {
  ok: 'low',
  missing_position_evidence: 'undetermined',
  missing_certificate: 'undetermined',
  certificate_expired: 'high',
  certificate_conflict: 'medium',
  insufficient_neighbors: 'undetermined',
  insufficient_comparable_days: 'medium',
  persistent_delta_below_threshold: 'muted',
  sparse_layout: 'undetermined',
  model_not_applicable: 'undetermined',
};
