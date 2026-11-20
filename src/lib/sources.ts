import type { SourceKind } from '../types';

export const KIND_META: Record<SourceKind, { label: string; short: string; tone: string; hint: string }> = {
  readings: { label: '室温读数', short: '读数', tone: 'accent', hint: '探头编号 + 时间 + 室温' },
  weather: { label: '气象观测', short: '气象', tone: 'cool', hint: '气象站 + 时间 + 室外温度' },
  work_orders: { label: '工单', short: '工单', tone: 'medium', hint: '工单号 + 楼栋 + 起止时间' },
  complaints: { label: '投诉', short: '投诉', tone: 'high', hint: '投诉号 + 地址 + 反映时段 + 描述' },
  registry: { label: '登记册', short: '登记', tone: 'teal', hint: '楼栋、别名与探头安装位置' },
};

export const KIND_ORDER: SourceKind[] = ['registry', 'readings', 'weather', 'work_orders', 'complaints'];
