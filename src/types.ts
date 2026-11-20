/** Core domain types for the heating comparability console. */

export type SourceKind = 'readings' | 'weather' | 'work_orders' | 'complaints' | 'registry';

export interface Reading {
  sensorId: string;
  ts: number;
  valueC: number;
  line: number;
}

export interface WeatherObs {
  stationId: string;
  ts: number;
  tempC: number;
  line: number;
}

export type WorkOrderKind =
  | 'supply_suspension'
  | 'valve_adjustment'
  | 'maintenance'
  | 'complaint_visit'
  | 'other';

export interface WorkOrder {
  id: string;
  buildingId: string | null;
  kind: WorkOrderKind;
  startTs: number;
  endTs: number;
  summary: string;
  recordedAt: number | null;
  line: number;
  rawBuilding: string;
}

export interface Complaint {
  id: string;
  rawAddress: string;
  windowStartTs: number;
  windowEndTs: number;
  channel: string;
  text: string;
  receivedAt: number | null;
  line: number;
}

export interface Building {
  id: string;
  name: string;
  complex: string;
  aliases: string[];
  addressNote: string;
}

export type ProbeOrientation = 'north' | 'south' | 'east' | 'west' | 'interior' | 'unknown';
export type RoomType = 'living_room' | 'bedroom' | 'kitchen' | 'stairwell' | 'other' | 'unknown';
export type WallPosition = 'external_wall' | 'internal_wall' | 'interior' | 'unknown';
export type CalibrationStatus = 'valid' | 'expired' | 'missing' | 'conflict';
export type ProbeLifecycleKind =
  | 'installed'
  | 'replaced'
  | 'relocated'
  | 'external_wall_works'
  | 'recalibrated'
  | 'removed';

/** 探头安装位置档案：每项都要能回查到位置证据（安装单/现场照片/登记说明）。 */
export interface ProbeInstallPosition {
  floor: number | null;
  heightM: number | null;
  orientation: ProbeOrientation;
  wallPosition: WallPosition;
  roomType: RoomType;
  exposureNote: string;
  /** 位置证据编号（安装单、现场照片或现场核查记录），为空视为无位置证据。 */
  evidenceRef: string;
  evidenceSinceTs: number | null;
}

export interface CalibrationCertificate {
  id: string;
  lab: string;
  calibratedAt: number;
  /** 有效期至；null 表示证书未标注有效期，按缺失有效期处理（门控不通过）。 */
  validUntil: number | null;
  /** 20℃ 校准点示值偏差（℃）：正=探头读数系统性偏高，负=偏低。 */
  biasAt20C: number | null;
  uncertaintyC: number | null;
  documentRef: string;
  statusNote: string;
}

export interface ProbeLifecycleEvent {
  id: string;
  kind: ProbeLifecycleKind;
  eventTs: number;
  summary: string;
  /** 支撑单据：更换工单、外墙改造工单、安装单等。 */
  documentRef: string;
  /** 迁移/外墙改造后生效的位置档案。 */
  positionAfter?: ProbeInstallPosition;
  /** 更换/重新校准后绑定的证书 id。 */
  certificateIdAfter?: string;
}

export interface NeighborLink {
  probeId: string;
  relation: 'same_building' | 'same_floor' | 'adjacent_building' | 'same_riser';
  floorDelta: number | null;
  note: string;
  evidenceRef: string;
}

export interface Probe {
  id: string;
  buildingId: string;
  label: string;
  intervalMin: number;
  installedAt: number;
  removedAt?: number;
  locationNote: string;
  /** 安装位置档案；缺省时偏差门控不允许自动校正。 */
  position?: ProbeInstallPosition | null;
  certificates?: CalibrationCertificate[];
  lifecycleEvents?: ProbeLifecycleEvent[];
  neighborLinks?: NeighborLink[];
}

export interface ParsedSource {
  kind: SourceKind;
  readings?: Reading[];
  weather?: WeatherObs[];
  workOrders?: WorkOrder[];
  complaints?: Complaint[];
  buildings?: Building[];
  probes?: Probe[];
}

export interface BatchCoverage {
  startTs: number | null;
  endTs: number | null;
  sensorIds: string[];
  buildingIds: string[];
  dayCounts: { dayKey: string; count: number }[];
}

export interface ImportIssue {
  code: string;
  message: string;
  count: number;
  severity: 'info' | 'warn' | 'error';
  samples?: string[];
}

export interface FieldMapping {
  [canonicalField: string]: string | null;
}

export interface ImportBatch {
  id: string;
  kind: SourceKind;
  fileName: string;
  fileHash: string;
  byteSize: number;
  importedAt: number;
  /** Logical delivery time; drives the run coverage cutoff for sample data. */
  ingestedAt: number;
  rowCount: number;
  invalidCount: number;
  duplicateCount: number;
  coverage: BatchCoverage;
  fieldMapping: FieldMapping;
  parserVersion: string;
  issues: ImportIssue[];
  /** First few raw rows, shown in the batch detail for field-mapping verification. */
  textPreview?: Record<string, string>[];
  data: ParsedSource;
}

export interface MappingVersion {
  id: string;
  version: number;
  createdAt: number;
  note: string;
  buildings: Building[];
  probes: Probe[];
}

export interface ComplaintCandidate {
  buildingId: string;
  score: number;
  reason: string;
}

export type ResolutionType = 'keep_existing' | 'adopt_new' | 'merge';

export interface ConflictResolution {
  type: ResolutionType;
  conflictWith: string[];
  reason: string;
  resolvedAt: number;
}

export interface AddressAssertion {
  id: string;
  addressKey: string;
  rawAddressSamples: string[];
  chosenBuildingIds: string[];
  candidates: ComplaintCandidate[];
  windowLabel: string;
  runId?: string;
  note: string;
  createdAt: number;
  superseded: boolean;
  resolution?: ConflictResolution;
}

export interface AnalysisConfig {
  windowStartDay: string;
  windowEndDay: string;
  heatingDayStartHour: number;
  comfortThresholdC: number;
  severeThresholdC: number;
  nightStartHour: number;
  nightEndHour: number;
  minCoverageRatio: number;
  minNightCoverageRatio: number;
  baselineMinDays: number;
  deficitDeltaC: number;
  sustainedMinHours: number;
  windowOpeningMaxMinutes: number;
  complaintPaddingMin: number;
  complaintMatchMinScore: number;
  outageGapFactor: number;
  // --- 探头位置偏差评估参数（随运行快照固定） ---
  /** 稳健邻近比较：室外温度匹配带宽（℃）。 */
  biasWeatherBandC: number;
  /** 邻近日覆盖率差异上限，超过则该邻近点不可比。 */
  biasCoverageTolerance: number;
  /** 位置偏差需达到的最小持续中位差（℃）才进入调整视图。 */
  biasMinPersistentDeltaC: number;
  /** 支持偏差结论所需的最少可比邻近供热日。 */
  biasMinComparableDays: number;
  /** 层级模型最少样本探头数；低于则模型不适用（稀疏布局）。 */
  biasModelMinProbes: number;
  /** 模型预测区间的置信水平（双侧分位，0.9 = p5–p95）。 */
  biasModelIntervalLevel: number;
}

export const DEFAULT_CONFIG: AnalysisConfig = {
  windowStartDay: '2026-01-05',
  windowEndDay: '2026-01-18',
  heatingDayStartHour: 6,
  comfortThresholdC: 18,
  severeThresholdC: 16,
  nightStartHour: 22,
  nightEndHour: 6,
  minCoverageRatio: 0.6,
  minNightCoverageRatio: 0.5,
  baselineMinDays: 3,
  deficitDeltaC: 2,
  sustainedMinHours: 3,
  windowOpeningMaxMinutes: 90,
  complaintPaddingMin: 30,
  complaintMatchMinScore: 0.9,
  outageGapFactor: 3,
  biasWeatherBandC: 3,
  biasCoverageTolerance: 0.2,
  biasMinPersistentDeltaC: 0.8,
  biasMinComparableDays: 3,
  biasModelMinProbes: 6,
  biasModelIntervalLevel: 0.9,
};

export type DayClass =
  | 'normal'
  | 'transient_disturbance'
  | 'local_equipment'
  | 'supply_shortfall'
  | 'insufficient_coverage'
  | 'unreliable_alignment';

export type RiskLevel = 'high' | 'medium' | 'low' | 'undetermined';

export interface Gap {
  startTs: number;
  endTs: number;
  minutes: number;
}

export interface ProbeDayStat {
  probeId: string;
  expected: number;
  received: number;
  coverageRatio: number;
  gaps: Gap[];
  medianIndoorC: number | null;
  medianResidualC: number | null;
}

export interface DayCoverage {
  expected: number;
  received: number;
  coverageRatio: number;
  nightExpected: number;
  nightReceived: number;
  nightCoverageRatio: number;
  weatherCoverageRatio: number;
  activeProbeIds: string[];
  probes: ProbeDayStat[];
  hasNoProbe: boolean;
  notes: string[];
}

export type EpisodeKind = 'transient' | 'local_equipment' | 'supply_shortfall' | 'unclassified';

export interface DeficitEpisode {
  id: string;
  startTs: number;
  endTs: number;
  durationMin: number;
  affectedProbeIds: string[];
  activeProbeCount: number;
  breadth: number;
  kind: EpisodeKind;
  minIndoorC: number;
  meanDeficitC: number;
  nightMinutes: number;
  workOrderIds: string[];
  sampleCount: number;
  evidenceRefs: EvidenceRef[];
  lowerBoundMin: number;
  upperBoundMin: number;
}

export interface BaselineInfo {
  valueC: number | null;
  p20C: number | null;
  p80C: number | null;
  daysUsed: number;
  source: 'stable' | 'fallback' | 'none';
  dayKeys: string[];
}

export interface HourPoint {
  ts: number;
  indoorC: number | null;
  outdoorC: number | null;
  lowProbeIds: string[];
}

export interface EvidenceRef {
  batchId: string;
  fileHash: string;
  fileName: string;
  rowLines?: number[];
  sensors?: string[];
  rangeStartTs?: number;
  rangeEndTs?: number;
  note: string;
}

export interface BuildingDayResult {
  id: string;
  buildingId: string;
  buildingName: string;
  complex: string;
  dayKey: string;
  dayStartTs: number;
  dayEndTs: number;
  classification: DayClass;
  risk: RiskLevel;
  riskScore: number | null;
  documented: boolean;
  coverage: DayCoverage;
  baseline: BaselineInfo;
  episodes: DeficitEpisode[];
  equipmentConfidence: number;
  alignmentConfidence: number;
  uncertainties: string[];
  explanation: string[];
  complaintIds: string[];
  hourly: HourPoint[];
  workOrderIds: string[];
  refs: EvidenceRef[];
}

export interface BuildingSummary {
  buildingId: string;
  name: string;
  complex: string;
  probeCount: number;
  risk: RiskLevel;
  riskScore: number | null;
  classCounts: Record<DayClass, number>;
  deficitDays: number;
  documentedDeficitDays: number;
  observedDeficitHours: number;
  coverageRatio: number;
  nightCoverageRatio: number;
  equipmentConfidence: number;
  alignmentConfidence: number;
  indeterminateDays: number;
  blindSpot: boolean;
  complaint: ComplaintSupportSummary;
  headline: string;
}

export interface ComplaintSupportSummary {
  total: number;
  supported: number;
  partial: number;
  contradicted: number;
  misaligned: number;
  unverifiable: number;
  unassigned: number;
}

export type ComplaintStatus =
  | 'supported'
  | 'partial'
  | 'contradicted'
  | 'misaligned'
  | 'unverifiable'
  | 'unassigned';

export interface ComplaintEpisodeEvidence {
  episodeId: string;
  startTs: number;
  endTs: number;
  kind: EpisodeKind;
  minIndoorC: number;
}

export interface ComplaintResult {
  complaintId: string;
  rawAddress: string;
  text: string;
  channel: string;
  windowStartTs: number;
  windowEndTs: number;
  windowInRun: boolean;
  candidates: ComplaintCandidate[];
  assignedBuildingIds: string[];
  mappingMode: 'auto' | 'manual' | 'ambiguous' | 'unassigned';
  mappingConfidence: number;
  status: ComplaintStatus;
  dayKeys: string[];
  coverageRatio: number;
  readingsCount: number;
  episodes: ComplaintEpisodeEvidence[];
  workOrders: { id: string; kind: WorkOrderKind; startTs: number; endTs: number; summary: string }[];
  explanation: string[];
  uncertainty: string;
  refs: EvidenceRef[];
  beforeAfterClassification?: DayClass;
}

export interface BlindSpot {
  buildingId: string;
  buildingName: string;
  complex: string;
  reason: string;
  affectedDays: string[];
  complaintCount: number;
}

export interface AlignmentIssue {
  code: string;
  message: string;
  count: number;
  severity: 'info' | 'warn' | 'error';
}

export interface RunTotals {
  buildings: number;
  buildingDays: number;
  evaluatedDays: number;
  indeterminateDays: number;
  highRiskBuildings: number;
  mediumRiskBuildings: number;
  lowRiskBuildings: number;
  undeterminedBuildings: number;
  complaints: number;
  supportedComplaints: number;
  partialComplaints: number;
  contradictedComplaints: number;
  misalignedComplaints: number;
  unverifiableComplaints: number;
  unassignedComplaints: number;
  observedDeficitHours: number;
  documentedDeficitHours: number;
  coverageRatio: number;
}

export interface RunResult {
  engineVersion: string;
  generatedAt: number;
  window: { startDay: string; endDay: string; dayKeys: string[] };
  config: AnalysisConfig;
  buildingDays: BuildingDayResult[];
  buildingSummaries: BuildingSummary[];
  complaints: ComplaintResult[];
  /** Work orders resolved to a building (unresolved ones are omitted, see alignmentIssues). */
  workOrders: WorkOrder[];
  blindSpots: BlindSpot[];
  alignmentIssues: AlignmentIssue[];
  totals: RunTotals;
  weatherSeries: { ts: number; tempC: number }[];
  mappingUsed: { buildings: Building[]; probes: Probe[] };
  assertionsUsed: AddressAssertion[];
  /** 探头位置偏差与楼栋风险敏感性评估；原始风险结论保持不变并作为 raw 视图保留。 */
  bias: BiasEvaluationSuite | null;
  diagnostics: {
    readingsUsed: number;
    weatherUsed: number;
    ordersUsed: number;
    duplicateReadingsRemoved: number;
    outOfWindowReadings: number;
    unresolvedAddresses: number;
  };
}

export interface InputRef {
  batchId: string;
  fileName: string;
  fileHash: string;
  kind: SourceKind;
  rowCount: number;
  ingestedAt: number;
  coverageStartTs: number | null;
  coverageEndTs: number | null;
}

export interface AnalysisRun {
  id: string;
  label: string;
  createdAt: number;
  dataCutoffTs: number;
  config: AnalysisConfig;
  inputRefs: InputRef[];
  mappingVersionId: string;
  mappingDigest: string;
  assertionsDigest: string;
  assertionsSnapshot: AddressAssertion[];
  mappingSnapshot: { buildings: Building[]; probes: Probe[] };
  result: RunResult;
  status: 'complete';
  engineVersion: string;
}

export interface LateDataNotice {
  batchId: string;
  fileName: string;
  kind: SourceKind;
  ingestedAt: number;
  rowsInWindow: number;
  eventStartTs: number | null;
  eventEndTs: number | null;
  message: string;
}

export interface RunComparison {
  baselineRunId: string;
  currentRunId: string;
  affectedComplaints: {
    complaintId: string;
    rawAddress: string;
    oldBuildingIds: string[];
    newBuildingIds: string[];
  }[];
  configChanged: boolean;
  configDiffs: { key: string; label: string; from: string; to: string }[];
  buildingDeltas: {
    buildingId: string;
    name: string;
    oldRisk: RiskLevel;
    newRisk: RiskLevel;
    oldClassCounts: Record<DayClass, number>;
    newClassCounts: Record<DayClass, number>;
  }[];
  mappingChanged: boolean;
}

export interface ParsedFilePreview {
  headers: string[];
  previewRows: Record<string, string>[];
  totalRows: number;
  suggestedKind: SourceKind;
  suggestedMapping: FieldMapping;
  jsonShape?: string;
}

// ---------------------------------------------------------------------------
// 探头位置偏差与楼栋风险敏感性评估
// ---------------------------------------------------------------------------

export type BiasRoute = 'robust_neighbor' | 'hierarchical_model';

export type BiasGateCode =
  | 'ok'
  | 'missing_position_evidence'
  | 'missing_certificate'
  | 'certificate_expired'
  | 'certificate_conflict'
  | 'insufficient_neighbors'
  | 'insufficient_comparable_days'
  | 'persistent_delta_below_threshold'
  | 'sparse_layout'
  | 'model_not_applicable';

/** 门控结论：任何一项证据不达标，adjustmentAllowed 必须为 false（不自动校正）。 */
export interface BiasGateResult {
  adjustmentAllowed: boolean;
  reasons: BiasGateCode[];
  detail: string[];
}

/** 路线A：单个供热日上的逐项邻近比较证据。 */
export interface NeighborComparisonPoint {
  dayKey: string;
  probeMedianC: number;
  neighborMedianC: number;
  deltaC: number;
  outdoorMedianC: number;
  probeCoverageRatio: number;
  neighborCoverageRatio: number;
  neighborProbeIds: string[];
  comparable: boolean;
  excludedReason: string | null;
}

/** 按事件时间切出的档案段：更换、外墙改造、重新校准都会触发拆段。 */
export interface ProbeBiasSegment {
  segmentIndex: number;
  startTs: number;
  endTs: number;
  trigger: ProbeLifecycleKind | 'window_start' | 'window_end';
  triggerEventId: string | null;
  certificateId: string | null;
  calibrationStatus: CalibrationStatus;
  positionEvidence: boolean;
  gate: BiasGateResult;
}

export interface RobustNeighborEstimate {
  route: 'robust_neighbor';
  segmentIndex: number;
  /** 探头相对邻近组合的稳健中位差（℃）；负值表示系统性偏低。 */
  persistentDeltaC: number | null;
  madDeltaC: number | null;
  comparableDayCount: number;
  neighborProbeIds: string[];
  points: NeighborComparisonPoint[];
  gate: BiasGateResult;
  /** 证据支持的调整量（℃，加到原始读数上的视角修正）；门控不通过时为 0。 */
  adjustmentC: number;
  adjustmentBasis: string[];
}

export interface HierarchicalProbeEstimate {
  route: 'hierarchical_model';
  segmentIndex: number;
  /** 位置固定效应（℃）：外墙、朝向、楼层、房间类型可解释的部分。 */
  positionEffectC: number | null;
  /** 探头随机效应（℃）：位置协变量解释不了的探头级残差，漂移落在这一项。 */
  driftEffectC: number | null;
  /** 预测区间半宽（℃），基于残差 MAD 与收缩后的随机效应方差。 */
  intervalHalfWidthC: number | null;
  intervalLevel: number;
  /** 经验贝叶斯收缩系数 0..1，越小表示越向同楼栋/同类型总体收缩。 */
  shrinkage: number;
  sampleCount: number;
  applicable: boolean;
  applicabilityNotes: string[];
  gate: BiasGateResult;
}

export interface ProbeBiasAssessment {
  probeId: string;
  buildingId: string;
  segments: ProbeBiasSegment[];
  robust: RobustNeighborEstimate[];
  model: HierarchicalProbeEstimate[];
  /**
   * 位置效应与漂移无法区分时的分量范围（℃）。
   * 观测到的邻近中位差 d ≈ positionComponent + driftComponent；门控不放行时，
   * 两个分量各自给出上下界，审查人可看到结论对归因方式的敏感性。
   */
  indistinguishableRangeC: {
    observedDeltaC: number;
    positionComponent: { lowerC: number; upperC: number };
    driftComponent: { lowerC: number; upperC: number };
    basis: string[];
  } | null;
  gate: BiasGateResult;
  notes: string[];
}

export interface BuildingBiasSensitivity {
  buildingId: string;
  rawRisk: RiskLevel;
  rawRiskScore: number | null;
  /** 路线A证据调整视图下的风险（门控不通过时与原始一致）。 */
  adjustedRisk: RiskLevel;
  adjustedRiskScore: number | null;
  /** 无法区分位置效应与漂移时，楼栋风险落在的上下界。 */
  rangeBound: { lowerRisk: RiskLevel; lowerScore: number | null; upperRisk: RiskLevel; upperScore: number | null };
  changed: boolean;
  drivingProbeIds: string[];
  explanation: string[];
}

export interface BiasEvaluationSuite {
  engineVersion: string;
  generatedAt: number;
  routeAEligibleSegments: number;
  routeAAdjustedSegments: number;
  routeBApplicableBuildingIds: string[];
  /** 楼栋内探头不足、回退到全小区池化后才适用的楼栋。 */
  routeBPooledBuildingIds: string[];
  routeBNotApplicable: { buildingId: string; reason: string }[];
  gateIssueCounts: Partial<Record<BiasGateCode, number>>;
  probeAssessments: ProbeBiasAssessment[];
  buildingSensitivity: BuildingBiasSensitivity[];
  comparisonPointCount: number;
  modelSpec: {
    formula: string;
    covariates: string[];
    intervalLevel: number;
    note: string;
  };
}

export interface SourceDescriptor {
  kind: SourceKind;
  title: string;
  short: string;
  accept: string;
  color: string;
  fields: { canonical: string; label: string; required: boolean; alternates: string[] }[];
  description: string;
}
