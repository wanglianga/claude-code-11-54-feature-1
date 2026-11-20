/** Address resolution between free-text complaint addresses and the building registry. */
import type { AddressAssertion, Building, ComplaintCandidate } from '../types';

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[（）()【】\[\]]/g, '')
    .replace(/[、，,。;；:：]/g, '|')
    .replace(/附近|周边|一带|左右|大概|好像|可能|记不清|说不清/g, '')
    .replace(/[#＃]/g, '');
}

function buildingTokens(b: Building): string[] {
  const tokens = new Set<string>();
  for (const alias of [b.name, `${b.complex}${b.name}`, ...b.aliases]) {
    const n = normalizeText(alias);
    if (n.length >= 2) tokens.add(n);
  }
  return [...tokens];
}

/** Extract the unit part (X单元) if present — used as a disambiguating signal only. */
function unitOf(address: string): string | null {
  const m = address.match(/(\d+)\s*单元/);
  return m ? m[1] : null;
}

export function addressKey(rawAddress: string): string {
  return normalizeText(rawAddress).replace(/\|/g, '').slice(0, 120);
}

/**
 * Score buildings against a raw address. Scores > 0 mean "mentions this building".
 * Conflicting mentions of two buildings are kept as separate candidates; the caller
 * decides whether the match is unique.
 */
export function scoreAddress(
  rawAddress: string,
  buildings: Building[],
  probesByBuilding: Map<string, string[]>,
): ComplaintCandidate[] {
  const norm = normalizeText(rawAddress);
  const out: ComplaintCandidate[] = [];
  const unit = unitOf(rawAddress);
  for (const b of buildings) {
    const tokens = buildingTokens(b);
    let best = 0;
    let bestToken = '';
    for (const token of tokens) {
      if (!norm.includes(token)) continue;
      // A bare "3号楼" must not match inside "13号楼".
      const idx = norm.indexOf(token);
      const before = norm[idx - 1];
      const after = norm[idx + token.length];
      const digitConflict = (before && /\d/.test(before) && /^\d/.test(token)) ||
        (after && /\d/.test(after) && /\d$/.test(token));
      if (digitConflict) continue;
      const score = token.length >= 8 ? 1 : token.length >= 5 ? 0.95 : 0.9;
      if (score > best) {
        best = score;
        bestToken = token;
      }
    }
    if (best === 0) continue;
    const reasons: string[] = [`地址包含「${bestToken}」`];
    let score = best;
    if (unit) {
      const probeLabels = probesByBuilding.get(b.id) ?? [];
      const hasUnit = probeLabels.some((l) => l.includes(`${unit}单元`));
      if (hasUnit) {
        score = Math.min(1, score + 0.05);
        reasons.push(`登记探头位于 ${unit} 单元`);
      } else if (probeLabels.length > 0) {
        reasons.push(`登记的 ${probeLabels.length} 个探头均不在 ${unit} 单元`);
      }
    }
    if (b.addressNote) reasons.push(b.addressNote);
    out.push({ buildingId: b.id, score: Math.round(score * 100) / 100, reason: reasons.join('；') });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export interface ResolutionOutcome {
  candidates: ComplaintCandidate[];
  chosen: string[];
  mode: 'auto' | 'manual' | 'ambiguous' | 'unassigned';
  confidence: number;
  message: string;
  assertionId?: string;
}

/**
 * Resolve a complaint address:
 * 1. An active manual assertion for this address key wins (manual override).
 * 2. A unique top candidate with a clear margin is auto-assigned.
 * 3. Multiple candidates (e.g. "8号楼、12号楼附近") remain ambiguous.
 * 4. No candidate → unassigned.
 */
export function resolveComplaintAddress(
  rawAddress: string,
  buildings: Building[],
  probesByBuilding: Map<string, string[]>,
  assertions: AddressAssertion[],
  matchMinScore = 0.9,
): ResolutionOutcome {
  const candidates = scoreAddress(rawAddress, buildings, probesByBuilding);
  const key = addressKey(rawAddress);
  const active = assertions.filter((a) => !a.superseded && a.addressKey === key);
  const current = active.sort((a, b) => b.createdAt - a.createdAt)[0];

  if (current && current.chosenBuildingIds.length > 0) {
    if (current.chosenBuildingIds.length > 1 || (current.resolution?.type === 'merge')) {
      return {
        candidates,
        chosen: current.chosenBuildingIds,
        mode: 'manual',
        confidence: 0.75,
        message: `人工合并归属为 ${current.chosenBuildingIds.length} 栋楼（${current.note || '人工确认'}）`,
        assertionId: current.id,
      };
    }
    return {
      candidates,
      chosen: current.chosenBuildingIds,
      mode: 'manual',
      confidence: 1,
      message: `人工确认归属：${current.note || '分析员修订'}`,
      assertionId: current.id,
    };
  }

  const strong = candidates.filter((c) => c.score >= matchMinScore);
  if (strong.length === 0) {
    return {
      candidates,
      chosen: [],
      mode: 'unassigned',
      confidence: 0,
      message: candidates.length
        ? `仅有低置信候选（${candidates.map((c) => c.score.toFixed(2)).join(' / ')}），不足以归属`
        : '地址中未识别出登记楼栋',
    };
  }
  if (strong.length === 1) {
    return {
      candidates,
      chosen: [strong[0].buildingId],
      mode: 'auto',
      confidence: strong[0].score,
      message: strong[0].reason,
    };
  }
  const sorted = [...strong].sort((a, b) => b.score - a.score);
  if (sorted[0].score - sorted[1].score < 0.06) {
    return {
      candidates: sorted,
      chosen: [],
      mode: 'ambiguous',
      confidence: sorted[0].score,
      message: `地址同时指向 ${sorted.map((c) => c.buildingId).join(' / ')}，需人工确认`,
    };
  }
  return {
    candidates: sorted,
    chosen: [sorted[0].buildingId],
    mode: 'auto',
    confidence: sorted[0].score,
    message: sorted[0].reason,
  };
}

/**
 * Find which registered buildings a free-text label mentions, using the same
 * digit-boundary rule as address scoring ("15号楼" must not match "5号楼").
 * Returns building ids in registry order; more than one means genuinely ambiguous.
 */
export function matchBuildingsInText(text: string, buildings: Building[]): string[] {
  const norm = normalizeText(text);
  const hits: string[] = [];
  for (const b of buildings) {
    const tokens = buildingTokens(b);
    for (const token of tokens) {
      const idx = norm.indexOf(token);
      if (idx < 0) continue;
      const before = norm[idx - 1];
      const after = norm[idx + token.length];
      const digitConflict =
        (before && /\d/.test(before) && /^\d/.test(token)) ||
        (after && /\d/.test(after) && /\d$/.test(token));
      if (digitConflict) continue;
      hits.push(b.id);
      break;
    }
  }
  return hits;
}

/** Detect assertions recorded by different windows that disagree for the same address. */
export function findAssertionConflicts(assertions: AddressAssertion[]): Array<{
  addressKey: string;
  sample: string;
  assertions: AddressAssertion[];
  keep: AddressAssertion;
}> {
  const byKey = new Map<string, AddressAssertion[]>();
  for (const a of assertions) {
    if (a.superseded) continue;
    if (a.chosenBuildingIds.length === 0) continue;
    const list = byKey.get(a.addressKey) ?? [];
    list.push(a);
    byKey.set(a.addressKey, list);
  }
  const conflicts: Array<{ addressKey: string; sample: string; assertions: AddressAssertion[]; keep: AddressAssertion }> = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const signatures = new Set(list.map((a) => [...a.chosenBuildingIds].sort().join('+')));
    if (signatures.size <= 1) continue;
    const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
    conflicts.push({
      addressKey: key,
      sample: sorted[0].rawAddressSamples[0] ?? key,
      assertions: sorted,
      keep: sorted[0],
    });
  }
  return conflicts;
}

export function candidateDifference(a: AddressAssertion, b: AddressAssertion): {
  onlyA: string[];
  onlyB: string[];
  shared: string[];
} {
  const setA = new Set(a.chosenBuildingIds);
  const setB = new Set(b.chosenBuildingIds);
  return {
    onlyA: a.chosenBuildingIds.filter((id) => !setB.has(id)),
    onlyB: b.chosenBuildingIds.filter((id) => !setA.has(id)),
    shared: a.chosenBuildingIds.filter((id) => setB.has(id)),
  };
}
