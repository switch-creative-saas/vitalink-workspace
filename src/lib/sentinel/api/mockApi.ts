/**
 * VitaLink Sentinel Mock API
 * Simulates backend API with realistic delays and responses
 */

import type {
  SentinelCase,
  OutbreakCluster,
  OutbreakDetails,
  PublicHealthAlert,
  CaseFilters,
  NewCaseData,
  CaseUpdateData,
  ResolutionData,
  NewAlertData,
  AlertFilters,
  ExportOptions,
  EpidemicCurve,
  ComparisonData,
  DataPoint,
  AIRecommendation,
  SurveillanceMetrics,
} from '@/types/sentinel';
import { DISEASE_CATALOG } from '@/lib/sentinel/diseaseCatalog';
import { generateHistoricalData } from './dataGenerators';

// Simulate network delay
const delay = (ms: number = 300) => new Promise(resolve => setTimeout(resolve, ms));

// In-memory storage (simulates backend database)
const storage = {
  cases: [] as SentinelCase[],
  outbreaks: [] as OutbreakCluster[],
  alerts: [] as PublicHealthAlert[],
  outbreakDetails: new Map<string, OutbreakDetails>(),
  aiRecommendations: [] as AIRecommendation[],
};

// Initialize with historical data
export function initializeMockData(tenantId: string) {
  const historicalData = generateHistoricalData(tenantId);
  storage.cases = historicalData.cases;
  storage.outbreaks = historicalData.outbreaks;
  storage.alerts = historicalData.alerts;
  storage.outbreakDetails = historicalData.outbreakDetails;
  storage.aiRecommendations = historicalData.aiRecommendations;
}

// ============================================
// CASE API
// ============================================

export async function getCases(filters?: CaseFilters): Promise<SentinelCase[]> {
  await delay(200);
  
  let cases = [...storage.cases];
  
  if (filters) {
    if (filters.diseases?.length) {
      cases = cases.filter(c => filters.diseases!.includes(c.diseaseId));
    }
    if (filters.states?.length) {
      cases = cases.filter(c => filters.states!.includes(c.geo.state));
    }
    if (filters.lgas?.length) {
      cases = cases.filter(c => filters.lgas!.includes(c.geo.lga));
    }
    if (filters.facilities?.length) {
      cases = cases.filter(c => filters.facilities!.includes(c.geo.facilityId));
    }
    if (filters.severity?.length) {
      cases = cases.filter(c => filters.severity!.includes(c.classification));
    }
    if (filters.ageGroups?.length) {
      cases = cases.filter(c => filters.ageGroups!.includes(c.ageGroup));
    }
    if (filters.genders?.length) {
      cases = cases.filter(c => filters.genders!.includes(c.gender));
    }
    if (filters.sources?.length) {
      cases = cases.filter(c => filters.sources!.includes(c.source));
    }
    if (filters.dateFrom) {
      cases = cases.filter(c => new Date(c.reportedAt) >= new Date(filters.dateFrom!));
    }
    if (filters.dateTo) {
      cases = cases.filter(c => new Date(c.reportedAt) <= new Date(filters.dateTo!));
    }
    if (filters.query) {
      const q = filters.query.toLowerCase();
      cases = cases.filter(c => 
        c.diseaseName.toLowerCase().includes(q) ||
        c.patientRef.toLowerCase().includes(q) ||
        c.geo.state.toLowerCase().includes(q) ||
        c.geo.lga.toLowerCase().includes(q) ||
        c.geo.facilityName.toLowerCase().includes(q) ||
        (c.notes && c.notes.toLowerCase().includes(q))
      );
    }
  }
  
  return cases.sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());
}

export async function getCaseById(id: string): Promise<SentinelCase | null> {
  await delay(150);
  return storage.cases.find(c => c.id === id) || null;
}

export async function createCase(data: NewCaseData, tenantId: string): Promise<SentinelCase> {
  await delay(400);
  
  const disease = DISEASE_CATALOG.find(d => d.id === data.diseaseId);
  if (!disease) throw new Error('Disease not found');
  
  const newCase: SentinelCase = {
    id: `case-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    tenantId,
    diseaseId: data.diseaseId,
    diseaseName: disease.name,
    category: disease.category,
    classification: data.classification,
    patientRef: data.patientRef || `ANON-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    ageGroup: data.ageGroup,
    gender: data.gender,
    reportedAt: new Date().toISOString(),
    source: data.source,
    geo: data.geo,
    notes: data.notes,
  };
  
  storage.cases.unshift(newCase);
  
  // Check for outbreaks
  await checkForOutbreak(newCase.diseaseId);
  
  return newCase;
}

export async function updateCase(id: string, data: CaseUpdateData): Promise<SentinelCase> {
  await delay(300);
  
  const index = storage.cases.findIndex(c => c.id === id);
  if (index === -1) throw new Error('Case not found');
  
  const updatedCase = { ...storage.cases[index], ...data };
  storage.cases[index] = updatedCase;
  
  return updatedCase;
}

export async function resolveCase(id: string, data: ResolutionData): Promise<void> {
  await delay(300);
  
  const index = storage.cases.findIndex(c => c.id === id);
  if (index === -1) throw new Error('Case not found');
  
  const resolvedClassification = data.status === 'fatal' ? 'fatal' : 
    data.status === 'transferred' ? 'confirmed' : 'recovered';
  
  storage.cases[index] = {
    ...storage.cases[index],
    classification: resolvedClassification,
    notes: `${storage.cases[index].notes || ''}\n[RESOLVED ${data.resolvedAt}] ${data.resolutionNotes}`.trim(),
  };
}

export async function deleteCase(id: string): Promise<void> {
  await delay(250);
  storage.cases = storage.cases.filter(c => c.id !== id);
}

// ============================================
// OUTBREAK API
// ============================================

export async function getActiveOutbreaks(): Promise<OutbreakCluster[]> {
  await delay(250);
  return storage.outbreaks.filter(o => o.status !== 'controlled');
}

export async function getAllOutbreaks(): Promise<OutbreakCluster[]> {
  await delay(250);
  return storage.outbreaks;
}

export async function getOutbreakDetails(id: string): Promise<OutbreakDetails | null> {
  await delay(350);
  return storage.outbreakDetails.get(id) || null;
}

async function checkForOutbreak(diseaseId: string): Promise<void> {
  const diseaseCases = storage.cases.filter(c => c.diseaseId === diseaseId && c.classification !== 'suspected');
  
  if (diseaseCases.length < 4) return; // Threshold
  
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentCases = diseaseCases.filter(c => new Date(c.reportedAt).getTime() >= weekAgo);
  
  if (recentCases.length < 3) return;
  
  const states = [...new Set(recentCases.map(c => c.geo.state))];
  const facilities = [...new Set(recentCases.map(c => c.geo.facilityId))];
  
  const disease = DISEASE_CATALOG.find(d => d.id === diseaseId)!;
  
  const outbreak: OutbreakCluster = {
    id: `ob-${diseaseId}-${Date.now()}`,
    diseaseId,
    diseaseName: disease.name,
    startedAt: new Date().toISOString(),
    status: recentCases.length >= 6 ? 'active' : 'watch',
    affectedStates: states,
    caseCount: recentCases.length,
    facilityCount: facilities.length,
    centroid: { lat: 6.5244, lng: 3.3792 },
    recommendedActions: [
      'Activate facility liaison network',
      'Increase surveillance frequency',
      'Prepare isolation pathways',
      'Coordinate with state health officials',
    ],
  };
  
  storage.outbreaks.unshift(outbreak);
  
  // Create outbreak details
  const details: OutbreakDetails = {
    ...outbreak,
    timeline: [
      {
        id: `evt-${Date.now()}`,
        date: outbreak.startedAt,
        type: 'detection',
        description: `Outbreak signal detected for ${disease.name}`,
        actor: 'Sentinel Automated System',
      },
    ],
    affectedFacilities: facilities.map(fid => {
      const facCases = recentCases.filter(c => c.geo.facilityId === fid);
      return {
        facilityId: fid,
        facilityName: facCases[0]?.geo.facilityName || 'Unknown',
        state: facCases[0]?.geo.state || 'Unknown',
        lga: facCases[0]?.geo.lga || 'Unknown',
        caseCount: facCases.length,
        firstCaseDate: facCases.reduce((min, c) => 
          new Date(c.reportedAt) < new Date(min) ? c.reportedAt : min, facCases[0].reportedAt),
        lastCaseDate: facCases.reduce((max, c) => 
          new Date(c.reportedAt) > new Date(max) ? c.reportedAt : max, facCases[0].reportedAt),
      };
    }),
    caseList: recentCases.map(c => c.id),
    investigationTeam: {
      lead: 'Unassigned',
      assignedAt: new Date().toISOString(),
    },
    controlMeasures: [
      { id: `cm-${Date.now()}-1`, measure: 'Contact tracing initiated', status: 'planned' },
      { id: `cm-${Date.now()}-2`, measure: 'Health worker training', status: 'planned' },
      { id: `cm-${Date.now()}-3`, measure: 'Community sensitization', status: 'planned' },
    ],
    riskAssessment: {
      severityScore: recentCases.length >= 10 ? 'critical' : recentCases.length >= 6 ? 'high' : 'moderate',
      confidenceLevel: 0.75,
      factors: [
        `Cases in ${states.length} state(s)`,
        `Spread across ${facilities.length} facilities`,
        'Recent increase in reporting',
      ],
    },
  };
  
  storage.outbreakDetails.set(outbreak.id, details);
  
  // Create alert
  const alert: PublicHealthAlert = {
    id: `alt-${outbreak.id}`,
    type: 'outbreak_warning',
    priority: outbreak.status === 'active' ? 'emergency' : 'high',
    title: `Outbreak Alert: ${disease.name}`,
    body: `${recentCases.length} confirmed cases across ${facilities.length} facilities in ${states.join(', ')}. Immediate response required.`,
    diseaseId,
    region: states[0],
    createdAt: new Date().toISOString(),
    delivery: { inApp: true, email: true, smsReady: true },
    acknowledged: false,
  };
  
  storage.alerts.unshift(alert);
}

// ============================================
// ALERT API
// ============================================

export async function getAlerts(filters?: AlertFilters): Promise<PublicHealthAlert[]> {
  await delay(200);
  
  let alerts = [...storage.alerts];
  
  if (filters) {
    if (filters.types?.length) {
      alerts = alerts.filter(a => filters.types!.includes(a.type));
    }
    if (filters.priorities?.length) {
      alerts = alerts.filter(a => filters.priorities!.includes(a.priority));
    }
    if (filters.acknowledged !== undefined) {
      alerts = alerts.filter(a => a.acknowledged === filters.acknowledged);
    }
    if (filters.dateFrom) {
      alerts = alerts.filter(a => new Date(a.createdAt) >= new Date(filters.dateFrom!));
    }
    if (filters.dateTo) {
      alerts = alerts.filter(a => new Date(a.createdAt) <= new Date(filters.dateTo!));
    }
    if (filters.regions?.length) {
      alerts = alerts.filter(a => a.region && filters.regions!.includes(a.region));
    }
  }
  
  return alerts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function createAlert(data: NewAlertData): Promise<PublicHealthAlert> {
  await delay(350);
  
  const alert: PublicHealthAlert = {
    id: `alt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: data.type,
    priority: data.priority,
    title: data.title,
    body: data.body,
    diseaseId: data.diseaseId,
    region: data.region,
    createdAt: new Date().toISOString(),
    delivery: {
      inApp: data.channels.includes('inApp'),
      email: data.channels.includes('email'),
      smsReady: data.channels.includes('sms'),
    },
    acknowledged: false,
  };
  
  storage.alerts.unshift(alert);
  
  // Simulate broadcast delay
  if (data.channels.includes('email') || data.channels.includes('sms')) {
    setTimeout(() => {
      console.log(`[Mock API] Broadcast sent for alert ${alert.id}`);
    }, 2000);
  }
  
  return alert;
}

export async function acknowledgeAlert(id: string, notes?: string): Promise<void> {
  await delay(200);
  
  const index = storage.alerts.findIndex(a => a.id === id);
  if (index === -1) throw new Error('Alert not found');
  
  storage.alerts[index] = {
    ...storage.alerts[index],
    acknowledged: true,
    body: notes ? `${storage.alerts[index].body}\n[Acknowledgment: ${notes}]` : storage.alerts[index].body,
  };
}

export async function resolveAlert(id: string): Promise<void> {
  await delay(200);
  storage.alerts = storage.alerts.filter(a => a.id !== id);
}

// ============================================
// ANALYTICS API
// ============================================

export async function getSurveillanceMetrics(): Promise<SurveillanceMetrics> {
  await delay(300);
  
  const cases = storage.cases;
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  
  const newCases24h = cases.filter(c => new Date(c.reportedAt).getTime() >= dayAgo).length;
  const lastWeekCases = cases.filter(c => {
    const t = new Date(c.reportedAt).getTime();
    return t >= weekAgo && t < dayAgo;
  }).length;
  
  const trendPercentage = lastWeekCases > 0 ? ((newCases24h * 7 - lastWeekCases) / lastWeekCases) * 100 : 0;
  
  const casesByClassification: Record<string, number> = { suspected: 0, probable: 0, confirmed: 0, recovered: 0, fatal: 0 };
  const casesByDisease: Record<string, number> = {};
  const casesByState: Record<string, number> = {};
  
  cases.forEach(c => {
    casesByClassification[c.classification] = (casesByClassification[c.classification] || 0) + 1;
    casesByDisease[c.diseaseName] = (casesByDisease[c.diseaseName] || 0) + 1;
    casesByState[c.geo.state] = (casesByState[c.geo.state] || 0) + 1;
  });
  
  return {
    totalCases: cases.length,
    newCases24h,
    activeOutbreaks: storage.outbreaks.filter(o => o.status !== 'controlled').length,
    pendingAlerts: storage.alerts.filter(a => !a.acknowledged).length,
    casesByClassification: casesByClassification as SurveillanceMetrics['casesByClassification'],
    casesByDisease,
    casesByState,
    trendDirection: trendPercentage > 5 ? 'up' : trendPercentage < -5 ? 'down' : 'stable',
    trendPercentage: Math.abs(trendPercentage),
  };
}

export async function getEpidemicCurve(diseaseId: string, days: number = 30): Promise<EpidemicCurve> {
  await delay(400);
  
  const disease = DISEASE_CATALOG.find(d => d.id === diseaseId);
  if (!disease) throw new Error('Disease not found');
  
  const cases = storage.cases.filter(c => c.diseaseId === diseaseId);
  const dataPoints: DataPoint[] = [];
  const movingAverage7d: DataPoint[] = [];
  
  const now = Date.now();
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    
    const count = cases.filter(c => c.reportedAt.startsWith(dateStr)).length;
    
    dataPoints.push({
      date: dateStr,
      value: count,
      label: date.toLocaleDateString('en-NG', { weekday: 'short' }),
    });
  }
  
  // Calculate 7-day moving average
  for (let i = 6; i < dataPoints.length; i++) {
    const sum = dataPoints.slice(i - 6, i + 1).reduce((acc, p) => acc + p.value, 0);
    movingAverage7d.push({
      date: dataPoints[i].date,
      value: Math.round(sum / 7),
      label: '7d avg',
    });
  }
  
  return {
    diseaseId,
    diseaseName: disease.name,
    dataPoints,
    movingAverage7d,
  };
}

export async function getRegionalComparison(regions: string[]): Promise<ComparisonData> {
  await delay(350);
  
  const cases = storage.cases;
  
  const casesByRegion: Record<string, number> = {};
  const incidenceByRegion: Record<string, number> = {};
  const growthByRegion: Record<string, number> = {};
  
  regions.forEach(region => {
    const regionCases = cases.filter(c => c.geo.state === region);
    casesByRegion[region] = regionCases.length;
    
    // Mock incidence (cases per 100,000)
    const mockPopulation = 5000000 + Math.random() * 10000000;
    incidenceByRegion[region] = Math.round((regionCases.length / mockPopulation) * 100000);
    
    // Mock growth rate
    growthByRegion[region] = Math.round((Math.random() - 0.3) * 50);
  });
  
  return {
    regions,
    metrics: {
      cases: casesByRegion,
      incidence: incidenceByRegion,
      growth: growthByRegion,
    },
  };
}

// ============================================
// EXPORT API
// ============================================

export async function exportCasesCsv(options: ExportOptions): Promise<Blob> {
  await delay(500);
  
  const cases = await getCases(options.filters);
  
  const headers = ['ID', 'Disease', 'Classification', 'Category', 'Age Group', 'Gender', 'State', 'LGA', 'Facility', 'Source', 'Reported At', 'Patient Ref'];
  
  const rows = cases.map(c => [
    options.anonymize ? '***' : c.id,
    c.diseaseName,
    c.classification,
    c.category,
    c.ageGroup,
    c.gender,
    c.geo.state,
    c.geo.lga,
    c.geo.facilityName,
    c.source,
    c.reportedAt,
    options.anonymize ? 'ANON' : c.patientRef,
  ]);
  
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  
  return new Blob([csv], { type: 'text/csv' });
}

export async function exportCasesPdf(options: ExportOptions): Promise<Blob> {
  await delay(800);
  
  // Mock PDF generation - return a text blob with metadata
  const cases = await getCases(options.filters);
  
  const report = `
SWITCH SENTINEL SURVEILLANCE REPORT
Generated: ${new Date().toISOString()}
Cases: ${cases.length}
Filters: ${JSON.stringify(options.filters)}

This is a mock PDF report. In production, this would be a generated PDF document.
  `;
  
  return new Blob([report], { type: 'application/pdf' });
}

// ============================================
// AI RECOMMENDATIONS API
// ============================================

export async function getAIRecommendations(): Promise<AIRecommendation[]> {
  await delay(300);
  return storage.aiRecommendations.filter(r => !r.acknowledged);
}

export async function acknowledgeAIRecommendation(id: string): Promise<void> {
  await delay(200);
  
  const index = storage.aiRecommendations.findIndex(r => r.id === id);
  if (index !== -1) {
    storage.aiRecommendations[index].acknowledged = true;
  }
}

// ============================================
// UTILITY API
// ============================================

export async function refreshTelemetry(): Promise<void> {
  await delay(1000);
  // Simulate data refresh from external sources
  console.log('[Mock API] Telemetry refreshed');
}

export function getStorageStats() {
  return {
    cases: storage.cases.length,
    outbreaks: storage.outbreaks.length,
    alerts: storage.alerts.length,
    outbreakDetails: storage.outbreakDetails.size,
    aiRecommendations: storage.aiRecommendations.length,
  };
}
