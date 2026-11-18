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

export interface Probe {
  id: string;
  buildingId: string;
  label: string;
  intervalMin: number;
  installedAt: number;
  removedAt?: number;
  locationNote: string;
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

export interface SourceDescriptor {
  kind: SourceKind;
  title: string;
  short: string;
  accept: string;
  color: string;
  fields: { canonical: string; label: string; required: boolean; alternates: string[] }[];
  description: string;
}
