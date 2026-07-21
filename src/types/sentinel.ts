/** VitaLink Sentinel — public health surveillance domain types */

export type DiseaseCategory = 'infectious' | 'ntd' | 'ncd';

export type CaseClassification = 'suspected' | 'probable' | 'confirmed' | 'recovered' | 'fatal';

export type SentinelHierarchyLevel = 'country' | 'state' | 'lga' | 'facility' | 'department';

export type AlertPriority = 'low' | 'medium' | 'high' | 'emergency';

export type PublicAlertType =
  | 'outbreak_warning'
  | 'mortality_spike'
  | 'medicine_shortage'
  | 'vaccine_shortage'
  | 'icu_overload'
  | 'disease_cluster';

export interface DiseaseDefinition {
  id: string;
  name: string;
  category: DiseaseCategory;
  /** Snippets used to match EMR / lab free text */
  matchTerms: string[];
  icd10Hints?: string[];
}

export interface SentinelGeoRef {
  country: string;
  state: string;
  lga: string;
  facilityId: string;
  facilityName: string;
  coordinates?: { lat: number; lng: number };
}

export interface SentinelCase {
  id: string;
  tenantId: string;
  diseaseId: string;
  diseaseName: string;
  category: DiseaseCategory;
  classification: CaseClassification;
  patientRef: string;
  /** Anonymized — never full name in surveillance store */
  ageGroup: string;
  gender: 'male' | 'female' | 'other' | 'unknown';
  reportedAt: string;
  source: 'emr_diagnosis' | 'lab_positive' | 'pharmacy_signal' | 'telemedicine' | 'community' | 'manual';
  geo: SentinelGeoRef;
  linkedVisitId?: string;
  linkedLabOrderId?: string;
  notes?: string;
}

export interface OutbreakCluster {
  id: string;
  diseaseId: string;
  diseaseName: string;
  startedAt: string;
  status: 'watch' | 'active' | 'controlled';
  affectedStates: string[];
  caseCount: number;
  facilityCount: number;
  centroid?: { lat: number; lng: number };
  recommendedActions: string[];
}

export interface SentinelThresholds {
  minCasesForSignal: number;
  growthPctWeekly: number;
  minFacilitiesInvolved: number;
  clusterRadiusKm: number;
}

export interface PublicHealthAlert {
  id: string;
  type: PublicAlertType;
  priority: AlertPriority;
  title: string;
  body: string;
  diseaseId?: string;
  region?: string;
  createdAt: string;
  delivery: { inApp: boolean; email: boolean; smsReady: boolean };
  acknowledged: boolean;
}

export interface ContactEdge {
  id: string;
  fromCaseId: string;
  toCaseId: string;
  relationship: 'household' | 'facility' | 'travel' | 'unknown';
  riskScore: number;
  notedAt: string;
}

export interface CommunityReport {
  id: string;
  reporterRole: string;
  facilityName: string;
  reportType: 'symptom_cluster' | 'suspected_outbreak' | 'mortality' | 'drug_shortage';
  summary: string;
  state: string;
  lga: string;
  createdAt: string;
  syncStatus: 'pending' | 'synced';
}

export interface VaccinationSeries {
  id: string;
  vaccineName: string;
  dosesScheduled: number;
  dosesAdministered: number;
  coveragePct: number;
  region: string;
}

export interface EmergencyCapacity {
  facilityId: string;
  name: string;
  bedsAvailable: number;
  bedsTotal: number;
  icuAvailable: number;
  icuTotal: number;
  oxygenUnitsAvailable: number;
  ambulancesAvailable: number;
}

export type SentinelTabId =
  | 'surveillance'
  | 'disease-tracking'
  | 'case-reporting'
  | 'outbreak'
  | 'heatmaps'
  | 'contact-tracing'
  | 'vaccination'
  | 'alerts'
  | 'epidemiology-analytics'
  | 'emergency'
  | 'community'
  | 'ntd';

// ============================================
// PHASE 1: ENHANCED TYPES FOR FULL FUNCTIONALITY
// ============================================

export interface CaseFilters {
  diseases?: string[];
  regions?: string[];
  states?: string[];
  lgas?: string[];
  facilities?: string[];
  severity?: CaseClassification[];
  ageGroups?: string[];
  genders?: ('male' | 'female' | 'other' | 'unknown')[];
  dateFrom?: string;
  dateTo?: string;
  sources?: SentinelCase['source'][];
  query?: string;
}

export interface OutbreakDetails extends OutbreakCluster {
  timeline: OutbreakEvent[];
  affectedFacilities: AffectedFacility[];
  caseList: string[]; // case IDs
  investigationTeam?: InvestigationTeam;
  controlMeasures: ControlMeasure[];
  riskAssessment: RiskAssessment;
}

export interface OutbreakEvent {
  id: string;
  date: string;
  type: 'detection' | 'confirmation' | 'escalation' | 'control' | 'closure';
  description: string;
  actor: string;
}

export interface AffectedFacility {
  facilityId: string;
  facilityName: string;
  state: string;
  lga: string;
  caseCount: number;
  firstCaseDate: string;
  lastCaseDate: string;
}

export interface InvestigationTeam {
  lead: string;
  epidemiologist?: string;
  labScientist?: string;
  contactTracer?: string;
  assignedAt: string;
}

export interface ControlMeasure {
  id: string;
  measure: string;
  status: 'planned' | 'active' | 'completed';
  targetDate?: string;
  completedAt?: string;
}

export interface RiskAssessment {
  r0Estimate?: number;
  doublingTime?: string;
  severityScore: 'low' | 'moderate' | 'high' | 'critical';
  confidenceLevel: number;
  factors: string[];
}

export interface NewCaseData {
  diseaseId: string;
  classification: CaseClassification;
  patientRef?: string;
  ageGroup: string;
  gender: 'male' | 'female' | 'other' | 'unknown';
  symptoms: string[];
  travelHistory?: string;
  vaccinationStatus?: 'vaccinated' | 'partial' | 'unvaccinated' | 'unknown';
  notes?: string;
  geo: SentinelGeoRef;
  source: SentinelCase['source'];
}

export interface CaseUpdateData {
  classification?: CaseClassification;
  symptoms?: string[];
  notes?: string;
  linkedLabOrderId?: string;
  linkedVisitId?: string;
}

export interface ResolutionData {
  status: 'resolved' | 'fatal' | 'transferred';
  resolvedAt: string;
  resolutionNotes: string;
}

export interface AlertFilters {
  types?: PublicAlertType[];
  priorities?: AlertPriority[];
  acknowledged?: boolean;
  dateFrom?: string;
  dateTo?: string;
  regions?: string[];
}

export interface NewAlertData {
  type: PublicAlertType;
  priority: AlertPriority;
  title: string;
  body: string;
  diseaseId?: string;
  region?: string;
  targetStates?: string[];
  targetLGAs?: string[];
  channels: ('inApp' | 'email' | 'sms')[];
}

export interface AlertAcknowledgment {
  alertId: string;
  acknowledgedBy: string;
  acknowledgedAt: string;
  notes?: string;
}

export interface ExportOptions {
  format: 'csv' | 'pdf';
  filters: CaseFilters;
  includeFields?: string[];
  anonymize: boolean;
}

export interface SyncStatus {
  lastSync: string | null;
  pendingCount: number;
  isSyncing: boolean;
  error?: string;
}

export interface PendingOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  entity: 'case' | 'alert' | 'report';
  data: unknown;
  timestamp: string;
  retryCount: number;
}

export interface SurveillanceMetrics {
  totalCases: number;
  newCases24h: number;
  activeOutbreaks: number;
  pendingAlerts: number;
  casesByClassification: Record<CaseClassification, number>;
  casesByDisease: Record<string, number>;
  casesByState: Record<string, number>;
  trendDirection: 'up' | 'down' | 'stable';
  trendPercentage: number;
}

export interface DataPoint {
  date: string;
  value: number;
  label?: string;
}

export interface EpidemicCurve {
  diseaseId: string;
  diseaseName: string;
  dataPoints: DataPoint[];
  movingAverage7d: DataPoint[];
}

export interface ComparisonData {
  regions: string[];
  metrics: {
    cases: Record<string, number>;
    incidence: Record<string, number>;
    growth: Record<string, number>;
  };
}

// VitaMind AI Types
export interface AIRecommendation {
  id: string;
  type: 'anomaly' | 'outbreak_pattern' | 'escalation' | 'intervention';
  title: string;
  description: string;
  confidence: number;
  relatedCases?: string[];
  relatedDisease?: string;
  recommendedAction: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
  acknowledged: boolean;
}

export interface AIInsightConfig {
  anomalySensitivity: number;
  outbreakThreshold: number;
  autoEscalation: boolean;
  notificationChannels: ('inApp' | 'email' | 'sms')[];
}
