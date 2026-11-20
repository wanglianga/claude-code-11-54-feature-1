// Generates deterministic sample CSV/JSON files for the heating comparability console.
// Scenario: 北岸新城 complex, heating days 2026-01-05 .. 2026-01-18 (local UTC+8, day starts 06:00).
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('public/samples');
fs.mkdirSync(OUT, { recursive: true });
const OFFSET = 8 * 3600_000;

const pad = (n) => String(n).padStart(2, '0');
const iso = (ts) => new Date(ts + OFFSET).toISOString().slice(0, 19) + '+08:00';
const tsOf = (s) => Date.parse(s);
const L = (y, m, d, h, mi = 0) => tsOf(`${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(mi)}:00+08:00`);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260105);
const noise = (amp) => (rand() - 0.5) * 2 * amp;

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers, rows) {
  return [headers.join(','), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(','))].join('\n') + '\n';
}
const write = (name, content) => fs.writeFileSync(path.join(OUT, name), content);

// ---------- registry ----------
const buildings = [
  {
    id: 'B01', name: '3号楼', complex: '北岸新城',
    aliases: ['北岸新城3号楼', '北岸新城三期3号楼', '3号楼'],
    address_note: '三期东区，1–3 单元',
  },
  {
    id: 'B02', name: '5号楼', complex: '北岸新城',
    aliases: ['北岸新城5号楼', '北岸新城三期5号楼', '5号楼'],
    address_note: '三期东区，1–2 单元',
  },
  {
    id: 'B03', name: '8号楼', complex: '北岸新城',
    aliases: ['北岸新城8号楼', '北岸新城三期8号楼', '8号楼'],
    address_note: '三期西区，1–3 单元，高区独立立管',
  },
  {
    id: 'B04', name: '7号楼', complex: '北岸新城',
    aliases: ['北岸新城7号楼', '北岸新城三期7号楼', '7号楼'],
    address_note: '三期西区，单探头',
  },
  {
    id: 'B05', name: '11号楼', complex: '北岸新城',
    aliases: ['北岸新城11号楼', '北岸新城三期11号楼', '11号楼'],
    address_note: '四期北区，2025 年交付，未装室温探头',
  },
  {
    id: 'B06', name: '2号楼', complex: '北岸新城',
    aliases: ['北岸新城2号楼', '北岸新城二期2号楼', '2号楼'],
    address_note: '二期，未装室温探头',
  },
  {
    id: 'B07', name: '12号楼', complex: '北岸新城',
    aliases: ['北岸新城12号楼', '北岸新城三期12号楼', '12号楼'],
    address_note: '三期西区，1–2 单元',
  },
  {
    id: 'B08', name: '1号楼', complex: '北岸新城',
    aliases: ['北岸新城1号楼', '北岸新城二期1号楼', '1号楼'],
    address_note: '二期，两个探头',
  },
  {
    id: 'B09', name: '6号楼', complex: '北岸新城',
    aliases: ['北岸新城6号楼', '北岸新城三期6号楼', '6号楼'],
    address_note: '三期东区，无投诉记录',
  },
];

// 位置档案与设备档案：安装高度、朝向、房间类型、位置证据、校准证书、生命周期事件、邻近探头。
const POS = {
  externalNorth: (floor, evidence, note) => ({
    floor, height_m: 1.5, orientation: 'north', wall_position: 'external_wall',
    room_type: 'living_room', exposure_note: note, evidence_ref: evidence,
    evidence_since: '2025-11-01T00:00:00+08:00',
  }),
  externalWestBedroom: (floor, evidence, note) => ({
    floor, height_m: 1.6, orientation: 'west', wall_position: 'external_wall',
    room_type: 'bedroom', exposure_note: note, evidence_ref: evidence,
    evidence_since: '2025-11-01T00:00:00+08:00',
  }),
  internal: (floor, room = 'living_room') => ({
    floor, height_m: 1.5, orientation: 'interior', wall_position: 'internal_wall',
    room_type: room, exposure_note: '内区中间户，远离外墙冷桥', evidence_ref: `INST-POS-${floor}`,
    evidence_since: '2025-11-01T00:00:00+08:00',
  }),
};

const validCert = (id, bias, lab = '市计量检定院') => ({
  id, lab, calibrated_at: '2025-11-02T10:00:00+08:00', valid_until: '2026-11-01T10:00:00+08:00',
  bias_at_20c: bias, uncertainty_c: 0.3, document_ref: `${id}.pdf`, status_note: '有效期覆盖整个采暖期',
});

const probes = [
  {
    id: 'P-301', building_id: 'B01', label: '3号楼1单元102客厅', interval_min: 10,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '一层，靠近外墙',
    // 场景一：外墙探头，证据齐全，长期比邻近中间户低 ~1.3℃（固定安装位置效应）。
    position: POS.externalNorth(1, 'INST-301', '一层北向外墙，窗下冷桥位置，安装单与现场照片齐全'),
    certificates: [validCert('CAL-301', 0.1)],
    lifecycle_events: [],
    neighbor_links: [{ probe_id: 'P-302', relation: 'same_building', floor_delta: 4, note: '同栋中间户对照', evidence_ref: 'SURVEY-B01' }],
  },
  {
    id: 'P-302', building_id: 'B01', label: '3号楼3单元501客厅', interval_min: 15,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '五层中间户',
    position: POS.internal(5), certificates: [validCert('CAL-302', 0.0)], lifecycle_events: [],
    neighbor_links: [{ probe_id: 'P-301', relation: 'same_building', floor_delta: -4, note: '外墙探头对照', evidence_ref: 'SURVEY-B01' }],
  },
  {
    id: 'P-501', building_id: 'B02', label: '5号楼1单元302客厅', interval_min: 10,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '三层中间户',
    position: POS.internal(3), certificates: [validCert('CAL-501', 0.05)], lifecycle_events: [],
    neighbor_links: [{ probe_id: 'P-502', relation: 'same_building', floor_delta: 1, note: '边户对照', evidence_ref: 'SURVEY-B02' }],
  },
  {
    id: 'P-502', building_id: 'B02', label: '5号楼2单元401客厅', interval_min: 15,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '四层边户',
    // 场景五：1/8 外墙保温改造完工，改造前后位置效应不同，按事件时间拆段评估。
    position: POS.externalNorth(4, 'INST-502', '四层北向外墙；2026-01-08 保温改造前冷桥明显'),
    certificates: [validCert('CAL-502', -0.1)],
    lifecycle_events: [{
      id: 'EV-502-WALL', kind: 'external_wall_works', event_ts: '2026-01-08T06:00:00+08:00',
      summary: '四层外墙保温改造完工，冷桥减弱，探头未移动', document_ref: 'WO-WALL-2026-007',
      position_after: POS.externalNorth(4, 'INST-502', '四层北向外墙；保温改造后冷桥显著减弱'),
    }],
    neighbor_links: [{ probe_id: 'P-501', relation: 'same_building', floor_delta: -1, note: '中间户对照', evidence_ref: 'SURVEY-B02' }],
  },
  {
    id: 'P-801', building_id: 'B03', label: '8号楼1单元601客厅', interval_min: 10,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '高区，六层',
    position: POS.internal(6), certificates: [validCert('CAL-801', 0.0)], lifecycle_events: [],
    neighbor_links: [{ probe_id: 'P-802', relation: 'same_riser', floor_delta: -3, note: '同立管对照', evidence_ref: 'SURVEY-B03' }],
  },
  {
    id: 'P-802', building_id: 'B03', label: '8号楼3单元402客厅', interval_min: 15,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '三层中间户',
    // 场景二：1/13 真实局部停供（立管阀门），偏差调整不得抹除该证据。
    position: POS.internal(3), certificates: [validCert('CAL-802', 0.05)], lifecycle_events: [],
    neighbor_links: [
      { probe_id: 'P-801', relation: 'same_riser', floor_delta: 3, note: '同立管对照', evidence_ref: 'SURVEY-B03' },
      { probe_id: 'P-803', relation: 'same_building', floor_delta: 5, note: '同栋边户对照', evidence_ref: 'SURVEY-B03' },
    ],
  },
  {
    id: 'P-803', building_id: 'B03', label: '8号楼2单元801卧室', interval_min: 30,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '八层边户',
    position: POS.externalWestBedroom(8, 'INST-803', '八层西向外墙卧室'),
    certificates: [validCert('CAL-803', 0.15)], lifecycle_events: [],
    neighbor_links: [{ probe_id: 'P-802', relation: 'same_building', floor_delta: -5, note: '中间户对照', evidence_ref: 'SURVEY-B03' }],
  },
  {
    id: 'P-701', building_id: 'B04', label: '7号楼2单元502客厅', interval_min: 15,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '五层中间户，唯一探头',
    // 场景五（稀疏布局）：全楼唯一探头且 1/8 后永久断线，无邻近可比、无证书 → 两条路线均不放行校正。
    position: POS.internal(5), certificates: [],
    lifecycle_events: [{
      id: 'EV-701-DEAD', kind: 'removed', event_ts: '2026-01-08T18:00:00+08:00',
      summary: '通信模块故障后停止上传，现场尚未更换', document_ref: 'WO-FAULT-701',
    }],
    neighbor_links: [],
  },
  {
    id: 'P-1201', building_id: 'B07', label: '12号楼1单元301客厅', interval_min: 15,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '三层中间户',
    position: POS.internal(3), certificates: [validCert('CAL-1201', 0.0)], lifecycle_events: [],
    neighbor_links: [{ probe_id: 'P-1202', relation: 'same_riser', floor_delta: 3, note: '同立管边户对照', evidence_ref: 'SURVEY-B07' }],
  },
  {
    id: 'P-1202', building_id: 'B07', label: '12号楼2单元604客厅', interval_min: 30,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '六层边户',
    // 场景四：1/9 探头更换，新旧证书按事件时间拆段；更换后新探头在外墙位置存在 ~1℃ 固定偏差。
    position: POS.externalNorth(6, 'INST-1202', '六层北向外墙边户，更换后仍装于原支架'),
    certificates: [
      { id: 'CAL-1202-A', lab: '市计量检定院', calibrated_at: '2025-11-02T10:00:00+08:00', valid_until: '2026-01-09T08:00:00+08:00', bias_at_20c: 0.1, uncertainty_c: 0.3, document_ref: 'CAL-1202-A.pdf', status_note: '旧探头证书，更换日到期' },
      { id: 'CAL-1202-B', lab: '市计量检定院', calibrated_at: '2026-01-09T09:30:00+08:00', valid_until: '2027-01-09T09:30:00+08:00', bias_at_20c: 0.2, uncertainty_c: 0.25, document_ref: 'CAL-1202-B.pdf', status_note: '更换后新探头出厂检定' },
    ],
    lifecycle_events: [{
      id: 'EV-1202-REPLACE', kind: 'replaced', event_ts: '2026-01-09T08:00:00+08:00',
      summary: '探头整体更换为新型号，新证书 CAL-1202-B', document_ref: 'WO-REPLACE-1202',
      certificate_id_after: 'CAL-1202-B',
      position_after: POS.externalNorth(6, 'INST-1202', '六层北向外墙边户，更换后仍装于原支架'),
    }],
    neighbor_links: [{ probe_id: 'P-1201', relation: 'same_riser', floor_delta: -3, note: '同立管中间户对照', evidence_ref: 'SURVEY-B07' }],
  },
  {
    id: 'P-1101', building_id: 'B08', label: '1号楼1单元201客厅', interval_min: 10,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '二层中间户',
    position: POS.internal(2), certificates: [validCert('CAL-1101', 0.0)], lifecycle_events: [],
    neighbor_links: [{ probe_id: 'P-1102', relation: 'same_building', floor_delta: 3, note: '同栋对照', evidence_ref: 'SURVEY-B08' }],
  },
  {
    id: 'P-1102', building_id: 'B08', label: '1号楼2单元502客厅', interval_min: 15,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '五层中间户',
    position: POS.internal(5), certificates: [validCert('CAL-1102', -0.05)], lifecycle_events: [],
    neighbor_links: [{ probe_id: 'P-1101', relation: 'same_building', floor_delta: -3, note: '同栋对照', evidence_ref: 'SURVEY-B08' }],
  },
  {
    id: 'P-601', building_id: 'B09', label: '6号楼1单元402客厅', interval_min: 15,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '四层中间户',
    position: POS.internal(4), certificates: [validCert('CAL-601', 0.0)], lifecycle_events: [],
    neighbor_links: [{ probe_id: 'P-602', relation: 'same_building', floor_delta: 3, note: '边户卧室对照', evidence_ref: 'SURVEY-B09' }],
  },
  {
    id: 'P-602', building_id: 'B09', label: '6号楼2单元703卧室', interval_min: 30,
    installed_at: '2025-11-01T00:00:00+08:00', removed_at: null, location_note: '七层边户',
    // 场景三：1/10 起渐进漂移；证书 2025 年底已过期，门控不放行自动校正，只能给出位置/漂移不可区分区间。
    position: POS.externalWestBedroom(7, 'INST-602', '七层西向外墙卧室，位置证据齐全但校准证书过期'),
    certificates: [{
      id: 'CAL-602-EXPIRED', lab: '市计量检定院', calibrated_at: '2024-12-20T10:00:00+08:00',
      valid_until: '2025-12-31T10:00:00+08:00', bias_at_20c: -0.2, uncertainty_c: 0.4,
      document_ref: 'CAL-602-EXPIRED.pdf', status_note: '证书已过期，复检计划排在采暖期结束后',
    }],
    lifecycle_events: [],
    neighbor_links: [{ probe_id: 'P-601', relation: 'same_building', floor_delta: -3, note: '中间户客厅对照', evidence_ref: 'SURVEY-B09' }],
  },
];

write('registry.json', JSON.stringify({
  dataset: '北岸新城 2025–2026 采暖期样例（匿名合成数据）',
  timezone: 'Asia/Shanghai',
  note: '所有门牌、投诉文本与设备编号均为合成数据，不含真实住户信息。',
  buildings,
  probes,
}, null, 2) + '\n');

// ---------- weather ----------
const weather = [];
{
  const start = L(2026, 1, 4, 0, 0);
  const end = L(2026, 1, 19, 6, 0);
  const gapStart = L(2026, 1, 9, 14, 0);
  const gapEnd = L(2026, 1, 9, 18, 0);
  for (let t = start; t < end; t += 30 * 60_000) {
    if (t >= gapStart && t < gapEnd) continue;
    const d = new Date(t + OFFSET);
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    const dayUtil = (t + OFFSET) / 86_400_000;
    let base = -8 + 3.2 * Math.sin(((hour - 9) / 24) * Math.PI * 2);
    // cold snap Jan 12 18:00 - Jan 14 12:00
    if (t >= L(2026, 1, 12, 18) && t < L(2026, 1, 14, 12)) base -= 6.5 + 1.2 * Math.sin((t / 3_600_000) * 0.7);
    const smooth = 0.6 * Math.sin(dayUtil * 1.7);
    weather.push({
      station_id: 'WX-NORTH-01',
      ts: iso(t),
      temp_c: (base + smooth + noise(0.25)).toFixed(2),
    });
  }
  // duplicated observation (idempotency test)
  weather.push({ ...weather[100] });
  weather.push({ ...weather[900] });
}
write('weather_2026-01.csv', toCsv(['station_id', 'ts', 'temp_c'], weather));

// ---------- readings ----------
const indoorBase = {
  'P-301': 20.7, 'P-302': 20.3, 'P-501': 20.6, 'P-502': 20.2,
  'P-801': 20.9, 'P-802': 20.4, 'P-803': 19.8, 'P-701': 20.1,
  'P-1201': 20.5, 'P-1202': 19.9, 'P-1101': 20.6, 'P-1102': 20.2,
  'P-601': 20.4, 'P-602': 20.0,
};
const probeById = new Map(probes.map((p) => [p.id, p]));

// Events: [start, end, targetC, probeIds|null]
const events = [
  // brief window opening, single probe, 45 minutes -> transient only
  { start: L(2026, 1, 8, 19, 50), end: L(2026, 1, 8, 20, 35), target: 16.8, probes: ['P-301'], note: 'window_open' },
  // documented night suspension (work order arrives on time)
  { start: L(2026, 1, 10, 22, 0), end: L(2026, 1, 11, 5, 0), target: 15.2, probes: ['P-501', 'P-502'], note: 'outage_documented' },
  // local riser/valve problem, one of three probes
  { start: L(2026, 1, 13, 17, 40), end: L(2026, 1, 13, 21, 30), target: 16.4, probes: ['P-802'], note: 'local_valve' },
  // night suspension documented only by a late backfilled work order
  { start: L(2026, 1, 15, 23, 30), end: L(2026, 1, 16, 4, 0), target: 16.2, probes: ['P-1201', 'P-1202'], note: 'outage_late_order' },
];

function eventDelta(probeId, t) {
  let target = null;
  for (const e of events) {
    if (!e.probes.includes(probeId)) continue;
    if (t < e.start || t >= e.end) continue;
    // 20 minute ramp into the event, 30 minute recovery at the end
    const rampIn = Math.min(1, (t - e.start) / (20 * 60_000));
    const rampOut = Math.min(1, (e.end - t) / (30 * 60_000));
    const w = Math.min(rampIn, rampOut);
    target = w < 1 ? 17.4 : e.target;
  }
  return target;
}

// 固定安装位置效应与探头漂移（与事件性停供相互独立，用于位置偏差评估验收）。
const DRIFT_START = L(2026, 1, 10, 0, 0);
function positionBias(probeId, t) {
  switch (probeId) {
    // 场景一：北向外墙冷桥，全窗口稳定 -1.3℃（证书证明仪器本身无负偏差）。
    case 'P-301':
      return -1.3;
    // 场景五：保温改造（1/8 06:00）前外墙冷桥 -1.0℃，改造后收敛到 -0.3℃。
    case 'P-502':
      return t < L(2026, 1, 8, 6, 0) ? -1.0 : -0.3;
    // 西向外墙卧室，轻度固定冷桥。
    case 'P-803':
      return -0.5;
    // 场景四：1/9 08:00 更换后的新探头在外墙支架上稳定偏低 ~1.0℃；更换前为 0。
    case 'P-1202':
      return t >= L(2026, 1, 9, 8, 0) ? -1.0 : 0;
    // 场景三：1/10 起渐进漂移，9 天内从 0 扩大到 -2.2℃，且校准证书已过期。
    case 'P-602': {
      if (t < DRIFT_START) return 0;
      const days = (t - DRIFT_START) / 86_400_000;
      return -Math.min(2.2, 0.25 * days);
    }
    default:
      return 0;
  }
}

const coreReadings = [];
const lateReadings = [];
const randPerProbe = new Map();
for (const p of probes) randPerProbe.set(p.id, mulberry32(1000 + probes.indexOf(p) * 137));

const readingStart = L(2026, 1, 4, 0, 0);
const readingEnd = L(2026, 1, 19, 6, 0);
const lateDayStart = L(2026, 1, 17, 6, 0);
const lateDayEnd = L(2026, 1, 18, 6, 0);

for (const p of probes) {
  const interval = p.interval_min * 60_000;
  const r = randPerProbe.get(p.id);
  const base = indoorBase[p.id];
  for (let t = readingStart; t < readingEnd; t += interval) {
    // deterministic +/- 20s upload jitter, kept inside the interval
    const jitter = Math.floor((r() - 0.5) * 20_000);
    const ts = t + jitter;
    // probe 801 connbox failure: no uploads Jan 14 00:00 -> Jan 16 06:00
    if (p.id === 'P-801' && ts >= L(2026, 1, 14, 0, 0) && ts < L(2026, 1, 16, 6, 0)) continue;
    // probe 701 dies permanently after Jan 8 18:00 (not backfilled)
    if (p.id === 'P-701' && ts >= L(2026, 1, 8, 18, 0)) continue;
    // 1号楼 Jan 17 heating day is delivered late (cutoff test)
    if ((p.id === 'P-1101' || p.id === 'P-1102') && ts >= lateDayStart && ts < lateDayEnd) {
      const lateHour = new Date(ts + OFFSET).getUTCHours();
      const late = base + 0.35 * Math.sin(((lateHour - 13) / 24) * Math.PI * 2) + (r() - 0.5) * 0.3;
      lateReadings.push({ sensor_id: p.id, ts: iso(ts), value_c: late.toFixed(2) });
      continue;
    }
    const d = new Date(ts + OFFSET);
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    let value = base + 0.35 * Math.sin(((hour - 13) / 24) * Math.PI * 2) + (r() - 0.5) * 0.3;
    value += positionBias(p.id, ts);
    const target = eventDelta(p.id, ts);
    if (target !== null) {
      value = Math.min(value, target + (r() - 0.5) * 0.25);
    }
    // one sticky sensor (P-803) produces a constant block, caught as a flatline warning
    coreReadings.push({ sensor_id: p.id, ts: iso(ts), value_c: value.toFixed(2) });
  }
}

// duplicate uploads (4) and malformed rows (3)
for (const i of [50, 4000, 12000, 20000]) coreReadings.push({ ...coreReadings[i] });
coreReadings.push({ sensor_id: 'P-301', ts: 'not-a-time', value_c: '20.1' });
coreReadings.push({ sensor_id: 'P-301', ts: '2026-01-06T10:05:00+08:00', value_c: '' });
coreReadings.push({ sensor_id: 'P-999', ts: '2026-01-06T10:05:00+08:00', value_c: '21.0' });
coreReadings.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
write('readings_2026-01.csv', toCsv(['sensor_id', 'ts', 'value_c'], coreReadings));
write('readings_late_2026-01-21.csv', toCsv(['sensor_id', 'ts', 'value_c'], lateReadings));

// ---------- work orders ----------
const workOrders = [
  {
    work_order_id: 'WO-2001', building: '北岸新城5号楼', type: 'supply_suspension',
    start: iso(L(2026, 1, 10, 21, 50)), end: iso(L(2026, 1, 11, 5, 10)),
    summary: '二次网支线阀门检修，1–2 单元整单元停供', recorded_at: iso(L(2026, 1, 12, 8, 0)),
  },
  {
    work_order_id: 'WO-2002', building: '北岸新城8号楼', type: 'valve_adjustment',
    start: iso(L(2026, 1, 13, 17, 30)), end: iso(L(2026, 1, 13, 18, 30)),
    summary: '3 单元立管阀门调整，部分住户流量下降', recorded_at: iso(L(2026, 1, 13, 18, 40)),
  },
  {
    work_order_id: 'WO-2003', building: '北岸新城3号楼', type: 'maintenance',
    start: iso(L(2026, 1, 16, 9, 0)), end: iso(L(2026, 1, 16, 11, 0)),
    summary: '换热站例行巡检，未停供', recorded_at: iso(L(2026, 1, 16, 11, 20)),
  },
  {
    work_order_id: 'WO-2004', building: '北岸新城12号楼', type: 'supply_suspension',
    start: iso(L(2026, 1, 12, 1, 0)), end: iso(L(2026, 1, 12, 3, 0)),
    summary: '12号楼高区临时停供（工单登记，探头读数未见对应下降）', recorded_at: iso(L(2026, 1, 12, 5, 30)),
  },
  {
    work_order_id: 'WO-2006', building: '北岸新城15号楼', type: 'maintenance',
    start: iso(L(2026, 1, 14, 10, 0)), end: iso(L(2026, 1, 14, 12, 0)),
    summary: '楼栋名称未在登记册中，需人工核对（地址对齐问题样例）', recorded_at: iso(L(2026, 1, 14, 13, 0)),
  },
  {
    work_order_id: 'WO-WALL-2026-007', building: '北岸新城5号楼', type: 'maintenance',
    start: iso(L(2026, 1, 7, 9, 0)), end: iso(L(2026, 1, 8, 6, 0)),
    summary: '4 层北向外墙保温改造完工，冷桥减弱；探头 P-502 未移动，位置档案按事件时间拆段',
    recorded_at: iso(L(2026, 1, 8, 7, 0)),
  },
  {
    work_order_id: 'WO-REPLACE-1202', building: '北岸新城12号楼', type: 'maintenance',
    start: iso(L(2026, 1, 9, 7, 30)), end: iso(L(2026, 1, 9, 8, 30)),
    summary: 'P-1202 探头整体更换，新探头沿用原外墙支架，绑定新校准证书 CAL-1202-B',
    recorded_at: iso(L(2026, 1, 9, 9, 0)),
  },
];
write('work_orders_2026-01.json', JSON.stringify(workOrders, null, 2) + '\n');

const lateWorkOrders = [
  {
    work_order_id: 'WO-2005', building: '北岸新城12号楼', type: 'supply_suspension',
    start: iso(L(2026, 1, 15, 23, 30)), end: iso(L(2026, 1, 16, 4, 10)),
    summary: '补录：12号楼夜间二次网失压停供', recorded_at: iso(L(2026, 1, 22, 9, 15)),
  },
];
write('work_orders_late_2026-01-21.csv', toCsv(
  ['work_order_id', 'building', 'type', 'start', 'end', 'summary', 'recorded_at'],
  lateWorkOrders,
));

// ---------- complaints ----------
const complaints = [
  {
    complaint_id: 'C-1001', address: '北岸新城3号楼1单元',
    window_start: iso(L(2026, 1, 8, 20, 0)), window_end: iso(L(2026, 1, 8, 21, 0)),
    channel: '12345热线', text: '晚上八点左右屋里突然变凉，像停了暖气，过一会儿又热了。',
    received_at: iso(L(2026, 1, 8, 21, 12)),
  },
  {
    complaint_id: 'C-1002', address: '北岸新城5号楼2单元',
    window_start: iso(L(2026, 1, 11, 3, 0)), window_end: iso(L(2026, 1, 11, 4, 30)),
    channel: '12345热线', text: '整夜冰凉，暖气片一点温度都没有，冻醒了。',
    received_at: iso(L(2026, 1, 11, 4, 40)),
  },
  {
    complaint_id: 'C-1003', address: '北岸新城8号楼3单元',
    window_start: iso(L(2026, 1, 13, 18, 30)), window_end: iso(L(2026, 1, 13, 21, 0)),
    channel: '企业热线', text: '我家暖气片不热，但邻居家说还行，不知道是不是我们这趟管的问题。',
    received_at: iso(L(2026, 1, 13, 21, 20)),
  },
  {
    complaint_id: 'C-1004', address: '北岸新城7号楼',
    window_start: iso(L(2026, 1, 12, 8, 0)), window_end: iso(L(2026, 1, 12, 20, 0)),
    channel: '12345热线', text: '最近一周家里都冷，具体几度没量过。',
    received_at: iso(L(2026, 1, 12, 20, 20)),
  },
  {
    complaint_id: 'C-1005', address: '北岸新城2号楼1单元',
    window_start: iso(L(2026, 1, 15, 21, 0)), window_end: iso(L(2026, 1, 15, 22, 30)),
    channel: '社区转办', text: '卧室冷，老人受不了，希望来看看。',
    received_at: iso(L(2026, 1, 15, 22, 45)),
  },
  {
    complaint_id: 'C-1006', address: '北岸新城8号楼、12号楼附近',
    window_start: iso(L(2026, 1, 15, 22, 0)), window_end: iso(L(2026, 1, 15, 23, 30)),
    channel: '12345热线', text: '具体哪栋记不清了，就在 8 号楼和 12 号楼之间，晚上很冷。',
    received_at: iso(L(2026, 1, 15, 23, 40)),
  },
  {
    complaint_id: 'C-1007', address: '北岸新城三期',
    window_start: iso(L(2026, 1, 9, 19, 0)), window_end: iso(L(2026, 1, 9, 21, 0)),
    channel: '社区转办', text: '家里冷，地址说不清楚，只知道是三期。',
    received_at: iso(L(2026, 1, 9, 21, 15)),
  },
  {
    complaint_id: 'C-1008', address: '北岸新城12号楼',
    window_start: iso(L(2026, 1, 12, 1, 30)), window_end: iso(L(2026, 1, 12, 3, 0)),
    channel: '企业热线', text: '半夜停暖了，早上才恢复。',
    received_at: iso(L(2026, 1, 12, 3, 10)),
  },
  {
    complaint_id: 'C-1009', address: '北岸新城1号楼2单元',
    window_start: iso(L(2026, 1, 17, 10, 0)), window_end: iso(L(2026, 1, 17, 12, 0)),
    channel: '12345热线', text: '上午屋里冷，暖气片温温的。',
    received_at: iso(L(2026, 1, 17, 12, 15)),
  },
  {
    complaint_id: 'C-1010', address: '北岸新城5号楼3单元',
    window_start: iso(L(2026, 1, 13, 9, 0)), window_end: iso(L(2026, 1, 13, 10, 0)),
    channel: '社区转办', text: '上午觉得冷，可能是我家窗户漏风。',
    received_at: iso(L(2026, 1, 13, 10, 20)),
  },
  {
    complaint_id: 'C-1011', address: '北岸新城12号楼1单元',
    window_start: iso(L(2026, 1, 16, 0, 30)), window_end: iso(L(2026, 1, 16, 3, 0)),
    channel: '12345热线', text: '半夜暖气停了，早上才慢慢恢复。',
    received_at: iso(L(2026, 1, 16, 3, 10)),
  },
];
write('complaints_2026-01.json', JSON.stringify(complaints, null, 2) + '\n');

// ---------- manifest ----------
const manifest = {
  dataset: '北岸新城供热可比性样例数据',
  version: '1.0',
  description: '用于验收探头断线、短时开窗、夜间停供、地址模糊投诉与补录工单等场景。',
  timezone: 'Asia/Shanghai',
  heating_day_start_hour: 6,
  window: { start_day: '2026-01-05', end_day: '2026-01-18' },
  samples: [
    { file: 'registry.json', kind: 'registry', delivered_at: iso(L(2026, 1, 19, 7, 50)), note: '楼栋与探头登记册' },
    { file: 'weather_2026-01.csv', kind: 'weather', delivered_at: iso(L(2026, 1, 19, 8, 40)), note: '园区气象站 30 分钟观测' },
    { file: 'readings_2026-01.csv', kind: 'readings', delivered_at: iso(L(2026, 1, 19, 9, 5)), note: '核心室温读数（含重复与坏行）' },
    { file: 'work_orders_2026-01.json', kind: 'work_orders', delivered_at: iso(L(2026, 1, 19, 9, 20)), note: '准时工单，含 1 条未知楼栋' },
    { file: 'complaints_2026-01.json', kind: 'complaints', delivered_at: iso(L(2026, 1, 19, 10, 0)), note: '热线投诉（模糊地址）' },
    { file: 'work_orders_late_2026-01-21.csv', kind: 'work_orders', delivered_at: iso(L(2026, 1, 21, 15, 30)), note: '补录工单 · 运行截止后到达' },
    { file: 'readings_late_2026-01-21.csv', kind: 'readings', delivered_at: iso(L(2026, 1, 21, 14, 10)), note: '迟到监测数据（1号楼 1/17 供热日）· 运行截止后到达' },
  ],
  expected_findings: {
    window_opening: 'C-1001 仅 45 分钟单探头下降，应判为短时扰动而非停供证据。',
    documented_outage: 'C-1002 有停供工单且双探头持续下降，应判为有据可查的供热不足。',
    local_fault: 'C-1003 三探头中仅一个下降，且工单为阀门调整，应判为局部设备问题。',
    probe_dead: '7号楼唯一探头自 1/8 18:00 停止上传，应判为覆盖不足、无法判断，而不是无风险。',
    no_probe: '11号楼与2号楼无探头，应列入监测盲区；2号楼投诉无法核实。',
    ambiguous_address: 'C-1006、C-1007 地址无法唯一归属，应保持未归属并给出候选。',
    misalignment: 'C-1008 工单记录停供但读数正常，监测与工单无法可靠对齐。',
    late_data: '1/17 供热日 1号楼读数与补录工单在截止后到达，旧运行应提示覆盖截止且不局部刷新。',
  },
  bias_scenarios: {
    external_wall_adjustable: 'P-301 北向外墙、证书有效且位置证据齐全，全窗口稳定比邻近 P-302 低约 1.3℃：路线 A 门控通过，调整视图上抬但原始读数与原始风险保留。',
    real_local_outage: 'P-802 无持续位置偏差，1/13 立管阀门导致的真实局部停供在原始视图、调整视图与不可区分区间下都不被抹除。',
    drift_expired_cert: 'P-602 自 1/10 渐进漂移且校准证书 2025 年底过期：门控拒绝自动校正，只给位置效应/漂移不可区分区间与模型预测区间，模型估计不得当作实测。',
    replacement_segments: 'P-1202 于 1/9 更换，按事件时间拆成两段：旧段无偏差，新段在外墙支架稳定偏低约 1.0℃，新证书有效时新段门控通过。',
    wall_works_segments: 'P-502 所在外墙 1/8 保温改造：拆段后改造前冷桥约 -1.0℃、改造后收敛到 -0.3℃（低于证据下限不再调整）。',
    sparse_layout: 'P-701 是 7 号楼唯一探头且无证书、无邻近探头：两条路线均不放行校正，层级模型标注适用范围，结论保持无法判断。',
  },
};
write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

console.log(`samples written to ${OUT}`);
console.log(`readings core: ${coreReadings.length}, late: ${lateReadings.length}, weather: ${weather.length}`);
