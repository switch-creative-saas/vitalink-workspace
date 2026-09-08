/**
 * VitaLink Sentinel Data Generators
 * Creates realistic historical epidemic data patterns
 * Based on real disease behaviors: cholera, COVID-19, malaria, Lassa fever, measles
 */

import type {
  SentinelCase,
  OutbreakCluster,
  OutbreakDetails,
  PublicHealthAlert,
  OutbreakEvent,
  AIRecommendation,
} from '@/types/sentinel';
import { DISEASE_CATALOG } from '@/lib/sentinel/diseaseCatalog';

// Nigeria states for geographic distribution
const NIGERIA_STATES = [
  'Lagos', 'Kano', 'Kaduna', 'Rivers', 'Oyo', 'Katsina', 'Borno', 'Bauchi',
  'Niger', 'Jigawa', 'Benue', 'Abia', 'Akwa Ibom', 'Edo', 'Plateau',
  'Enugu', 'Ogun', 'Ondo', 'Sokoto', 'Delta', 'Osun', 'Anambra',
];

// LGAs per state (sample)
const STATE_LGAS: Record<string, string[]> = {
  'Lagos': ['Ikeja', 'Surulere', 'Eti-Osa', 'Alimosho', 'Kosofe', 'Mushin'],
  'Rivers': ['Port Harcourt', 'Obio/Akpor', 'Ikwerre', 'Etche'],
  'Oyo': ['Ibadan North', 'Ibadan South', 'Ogbomosho'],
  'Kano': ['Nasarawa', 'Fagge', 'Gwale', 'Dala'],
  'Kaduna': ['Kaduna North', 'Kaduna South', 'Zaria'],
};

interface GeneratedData {
  cases: SentinelCase[];
  outbreaks: OutbreakCluster[];
  alerts: PublicHealthAlert[];
  outbreakDetails: Map<string, OutbreakDetails>;
  aiRecommendations: AIRecommendation[];
}

export function generateHistoricalData(tenantId: string): GeneratedData {
  const cases: SentinelCase[] = [];
  const outbreaks: OutbreakCluster[] = [];
  const alerts: PublicHealthAlert[] = [];
  const outbreakDetails = new Map<string, OutbreakDetails>();
  const aiRecommendations: AIRecommendation[] = [];
  
  const now = Date.now();
  
  // Generate Cholera Outbreak Pattern (Lagos, rainy season spike)
  const choleraOutbreak = generateCholeraOutbreak(tenantId, now);
  cases.push(...choleraOutbreak.cases);
  outbreaks.push(choleraOutbreak.outbreak);
  alerts.push(...choleraOutbreak.alerts);
  outbreakDetails.set(choleraOutbreak.outbreak.id, choleraOutbreak.details);
  
  // Generate COVID-19 Wave Pattern
  const covidData = generateCOVIDPattern(tenantId, now);
  cases.push(...covidData.cases);
  outbreaks.push(...covidData.outbreaks);
  alerts.push(...covidData.alerts);
  covidData.outbreakDetails.forEach((details, id) => outbreakDetails.set(id, details));
  
  // Generate Malaria Seasonality Data
  const malariaData = generateMalariaSeasonality(tenantId, now);
  cases.push(...malariaData);
  
  // Generate Lassa Fever Cluster (Dry season pattern)
  const lassaData = generateLassaFeverCluster(tenantId, now);
  cases.push(...lassaData.cases);
  if (lassaData.outbreak) {
    outbreaks.push(lassaData.outbreak);
    alerts.push(...lassaData.alerts);
    outbreakDetails.set(lassaData.outbreak.id, lassaData.details);
  }
  
  // Generate Measles Outbreak (Under-vaccinated population)
  const measlesData = generateMeaslesOutbreak(tenantId, now);
  cases.push(...measlesData.cases);
  if (measlesData.outbreak) {
    outbreaks.push(measlesData.outbreak);
    alerts.push(...measlesData.alerts);
    outbreakDetails.set(measlesData.outbreak.id, measlesData.details);
  }
  
  // Generate background cases (other diseases)
  const backgroundCases = generateBackgroundCases(tenantId, now, 50);
  cases.push(...backgroundCases);
  
  // Generate AI recommendations
  aiRecommendations.push(...generateAIRecommendations(outbreaks, cases));
  
  return {
    cases: cases.sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime()),
    outbreaks,
    alerts: alerts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    outbreakDetails,
    aiRecommendations,
  };
}

// Cholera: Rapid onset during rainy season, 2-4 week duration
function generateCholeraOutbreak(tenantId: string, now: number) {
  const disease = DISEASE_CATALOG.find(d => d.id === 'cholera')!;
  const outbreakStart = now - 21 * 24 * 60 * 60 * 1000; // 3 weeks ago
  
  const cases: SentinelCase[] = [];
  const affectedStates = ['Lagos', 'Ogun'];
  const affectedFacilities = ['Lagos Central Hospital', 'Randle Hospital', 'LASUTH'];
  
  // Generate 45 cases with epidemic curve pattern (rising, peak, declining)
  const caseCounts = [2, 3, 5, 8, 10, 8, 5, 3, 1]; // 9 days of outbreak
  
  caseCounts.forEach((count, dayIndex) => {
    for (let i = 0; i < count; i++) {
      const date = new Date(outbreakStart + dayIndex * 24 * 60 * 60 * 1000 + i * 2 * 60 * 60 * 1000);
      cases.push(createCase(tenantId, disease, 'confirmed', date.toISOString(), {
        state: affectedStates[Math.floor(Math.random() * affectedStates.length)],
        lga: 'Ikeja',
        facility: affectedFacilities[Math.floor(Math.random() * affectedFacilities.length)],
        ageGroup: ['5-14', '15-44'][Math.floor(Math.random() * 2)], // Children and young adults more affected
      }));
    }
  });
  
  const outbreak: OutbreakCluster = {
    id: `ob-cholera-${outbreakStart}`,
    diseaseId: disease.id,
    diseaseName: disease.name,
    startedAt: new Date(outbreakStart).toISOString(),
    status: 'active',
    affectedStates,
    caseCount: cases.length,
    facilityCount: affectedFacilities.length,
    centroid: { lat: 6.5244, lng: 3.3792 },
    recommendedActions: [
      'Distribute oral rehydration salts (ORS) to affected communities',
      'Activate cholera treatment centers',
      'Conduct water source chlorination',
      'Intensify hygiene promotion campaigns',
      'Coordinate with WASH partners',
    ],
  };
  
  const details = createOutbreakDetails(outbreak, cases, affectedFacilities, [
    { type: 'detection', desc: 'Cluster of acute watery diarrhea cases detected in Lagos Central' },
    { type: 'confirmation', desc: 'Vibrio cholerae confirmed by laboratory testing' },
    { type: 'escalation', desc: 'Outbreak declared active - multi-facility spread detected' },
  ]);
  
  const alerts: PublicHealthAlert[] = [
    {
      id: `alt-${outbreak.id}-1`,
      type: 'outbreak_warning',
      priority: 'emergency',
      title: 'Cholera Outbreak Alert: Lagos/Ogun',
      body: `${cases.length} confirmed cholera cases across ${affectedFacilities.length} facilities. Immediate response required. Activate cholera treatment protocols.`,
      diseaseId: disease.id,
      region: 'Lagos',
      createdAt: new Date(outbreakStart + 3 * 24 * 60 * 60 * 1000).toISOString(),
      delivery: { inApp: true, email: true, smsReady: true },
      acknowledged: false,
    },
  ];
  
  return { cases, outbreak, alerts, details };
}

// COVID-19: Wave patterns with Rt progression
function generateCOVIDPattern(tenantId: string, now: number) {
  const disease = DISEASE_CATALOG.find(d => d.id === 'covid-19')!;
  const cases: SentinelCase[] = [];
  const outbreaks: OutbreakCluster[] = [];
  const alerts: PublicHealthAlert[] = [];
  const outbreakDetails = new Map<string, OutbreakDetails>();
  
  // Current wave (last 45 days)
  const waveStart = now - 45 * 24 * 60 * 60 * 1000;
  const dailyCounts = generateEpidemicCurve(45, 5, 25, 'wave'); // 45 days, min 5, max 25 cases/day
  
  dailyCounts.forEach((count, dayIndex) => {
    for (let i = 0; i < count; i++) {
      const date = new Date(waveStart + dayIndex * 24 * 60 * 60 * 1000 + i * 60 * 60 * 1000);
      const state = NIGERIA_STATES[Math.floor(Math.random() * 10)];
      cases.push(createCase(tenantId, disease, Math.random() > 0.7 ? 'confirmed' : 'probable', date.toISOString(), {
        state,
        lga: (STATE_LGAS[state] || ['Central'])[0],
        facility: 'General Hospital',
        ageGroup: ['15-44', '45-64', '65+'][Math.floor(Math.random() * 3)],
      }));
    }
  });
  
  // Create outbreak for current wave
  const currentWaveCases = cases.filter(c => 
    new Date(c.reportedAt).getTime() > now - 14 * 24 * 60 * 60 * 1000
  );
  
  if (currentWaveCases.length > 10) {
    const states = [...new Set(currentWaveCases.map(c => c.geo.state))];
    const outbreak: OutbreakCluster = {
      id: `ob-covid-${waveStart}`,
      diseaseId: disease.id,
      diseaseName: disease.name,
      startedAt: new Date(waveStart).toISOString(),
      status: 'watch',
      affectedStates: states.slice(0, 5),
      caseCount: currentWaveCases.length,
      facilityCount: Math.min(8, Math.floor(currentWaveCases.length / 5)),
      centroid: { lat: 9.082, lng: 8.6753 },
      recommendedActions: [
        'Monitor ICU capacity',
        'Ensure oxygen supply availability',
        'Review vaccination coverage data',
        'Prepare surge staffing plans',
      ],
    };
    
    outbreaks.push(outbreak);
    outbreakDetails.set(outbreak.id, createOutbreakDetails(outbreak, currentWaveCases, [], [
      { type: 'detection', desc: 'Sustained increase in COVID-19 cases detected' },
    ]));
    
    alerts.push({
      id: `alt-${outbreak.id}`,
      type: 'disease_cluster',
      priority: 'high',
      title: 'COVID-19 Surge Watch',
      body: `Increasing trend in COVID-19 cases over past 2 weeks. ${currentWaveCases.length} new cases. Monitor hospital capacity.`,
      diseaseId: disease.id,
      region: states[0],
      createdAt: new Date(waveStart + 14 * 24 * 60 * 60 * 1000).toISOString(),
      delivery: { inApp: true, email: true, smsReady: false },
      acknowledged: true,
    });
  }
  
  return { cases, outbreaks, alerts, outbreakDetails };
}

// Malaria: Seasonal peaks aligned with rainfall (higher in rainy season)
function generateMalariaSeasonality(tenantId: string, now: number) {
  const disease = DISEASE_CATALOG.find(d => d.id === 'malaria')!;
  const cases: SentinelCase[] = [];
  
  // Generate cases for last 90 days with seasonal pattern
  for (let day = 0; day < 90; day++) {
    const date = new Date(now - day * 24 * 60 * 60 * 1000);
    const month = date.getMonth(); // 0-11
    
    // Higher in rainy season (April-October in Nigeria)
    const isRainySeason = month >= 3 && month <= 9;
    const baseCases = isRainySeason ? 8 : 3;
    const dailyCases = baseCases + Math.floor(Math.random() * 5);
    
    for (let i = 0; i < dailyCases; i++) {
      cases.push(createCase(tenantId, disease, Math.random() > 0.3 ? 'confirmed' : 'probable', date.toISOString(), {
        state: NIGERIA_STATES[Math.floor(Math.random() * 15)],
        lga: 'General',
        facility: 'Primary Health Centre',
        ageGroup: ['0-4', '5-14'][Math.floor(Math.random() * 2)], // Children most affected
      }));
    }
  }
  
  return cases;
}

// Lassa Fever: Dry season clustering (November-April)
function generateLassaFeverCluster(tenantId: string, now: number) {
  const disease = DISEASE_CATALOG.find(d => d.id === 'lassa')!;
  const clusterStart = now - 60 * 24 * 60 * 60 * 1000; // 60 days ago
  
  const cases: SentinelCase[] = [];
  const affectedStates = ['Edo', 'Ondo', 'Ebonyi'];
  
  // Generate 15 cases over 3 weeks
  for (let day = 0; day < 21; day++) {
    const casesToday = day < 7 ? Math.floor(Math.random() * 2) : day < 14 ? 1 : 0;
    
    for (let i = 0; i < casesToday; i++) {
      const date = new Date(clusterStart + day * 24 * 60 * 60 * 1000 + i * 4 * 60 * 60 * 1000);
      cases.push(createCase(tenantId, disease, 'confirmed', date.toISOString(), {
        state: affectedStates[Math.floor(Math.random() * affectedStates.length)],
        lga: 'Irrua',
        facility: 'Irrua Specialist Teaching Hospital',
        ageGroup: ['15-44', '45-64'][Math.floor(Math.random() * 2)],
      }));
    }
  }
  
  if (cases.length >= 5) {
    const outbreak: OutbreakCluster = {
      id: `ob-lassa-${clusterStart}`,
      diseaseId: disease.id,
      diseaseName: disease.name,
      startedAt: new Date(clusterStart).toISOString(),
      status: 'controlled',
      affectedStates,
      caseCount: cases.length,
      facilityCount: 3,
      centroid: { lat: 6.5, lng: 6.0 },
      recommendedActions: [
        'Contact tracing completed',
        'Rodent control measures implemented',
        'Health worker training completed',
        'Community sensitization done',
      ],
    };
    
    const details = createOutbreakDetails(outbreak, cases, ['Irrua Specialist Teaching Hospital'], [
      { type: 'detection', desc: 'Lassa fever cases detected in Edo State' },
      { type: 'confirmation', desc: 'Laboratory confirmation by PCR' },
      { type: 'control', desc: 'Contact tracing and rodent control initiated' },
      { type: 'closure', desc: 'Outbreak declared controlled - no new cases in 21 days' },
    ]);
    
    const alerts: PublicHealthAlert[] = [
      {
        id: `alt-${outbreak.id}`,
        type: 'outbreak_warning',
        priority: 'high',
        title: 'Lassa Fever Outbreak - Edo/Ondo States',
        body: `${cases.length} confirmed Lassa fever cases. Contact tracing active. Implement rodent control measures.`,
        diseaseId: disease.id,
        region: 'Edo',
        createdAt: new Date(clusterStart + 5 * 24 * 60 * 60 * 1000).toISOString(),
        delivery: { inApp: true, email: true, smsReady: true },
        acknowledged: true,
      },
    ];
    
    return { cases, outbreak, alerts, details };
  }
  
  return { cases, outbreak: null, alerts: [], details: null };
}

// Measles: Outbreaks in under-vaccinated populations
function generateMeaslesOutbreak(tenantId: string, now: number) {
  const disease = DISEASE_CATALOG.find(d => d.id === 'measles')!;
  const outbreakStart = now - 35 * 24 * 60 * 60 * 1000; // 5 weeks ago
  
  const cases: SentinelCase[] = [];
  const affectedStates = ['Kano', 'Katsina'];
  
  // Generate 30 cases with secondary transmission pattern
  const dailyPattern = [2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 21 days
  
  dailyPattern.forEach((count, day) => {
    for (let i = 0; i < count; i++) {
      const date = new Date(outbreakStart + day * 24 * 60 * 60 * 1000 + i * 3 * 60 * 60 * 1000);
      cases.push(createCase(tenantId, disease, 'confirmed', date.toISOString(), {
        state: affectedStates[Math.floor(Math.random() * affectedStates.length)],
        lga: 'Ungogo',
        facility: 'Murtala Mohammed Specialist Hospital',
        ageGroup: '0-4', // Mostly children under 5
      }));
    }
  });
  
  if (cases.length >= 10) {
    const outbreak: OutbreakCluster = {
      id: `ob-measles-${outbreakStart}`,
      diseaseId: disease.id,
      diseaseName: disease.name,
      startedAt: new Date(outbreakStart).toISOString(),
      status: 'controlled',
      affectedStates,
      caseCount: cases.length,
      facilityCount: 4,
      centroid: { lat: 12.0, lng: 8.5 },
      recommendedActions: [
        'Reactive vaccination campaign completed',
        'Vitamin A supplementation administered',
        'Active case search in affected LGAs',
        'Community engagement on vaccination importance',
      ],
    };
    
    const details = createOutbreakDetails(outbreak, cases, ['Murtala Mohammed Specialist Hospital'], [
      { type: 'detection', desc: 'Cluster of febrile rash illness in children' },
      { type: 'confirmation', desc: 'Measles IgM positive in 8 samples' },
      { type: 'escalation', desc: 'Outbreak declared - low vaccination coverage identified' },
      { type: 'control', desc: 'Reactive vaccination initiated' },
      { type: 'closure', desc: '42 days since last case - outbreak closed' },
    ]);
    
    const alerts: PublicHealthAlert[] = [
      {
        id: `alt-${outbreak.id}`,
        type: 'outbreak_warning',
        priority: 'high',
        title: 'Measles Outbreak - Kano/Katsina',
        body: `${cases.length} confirmed measles cases in under-vaccinated communities. Reactive vaccination ongoing.`,
        diseaseId: disease.id,
        region: 'Kano',
        createdAt: new Date(outbreakStart + 7 * 24 * 60 * 60 * 1000).toISOString(),
        delivery: { inApp: true, email: true, smsReady: true },
        acknowledged: true,
      },
    ];
    
    return { cases, outbreak, alerts, details };
  }
  
  return { cases, outbreak: null, alerts: [], details: null };
}

// Background cases - other diseases for realistic volume
function generateBackgroundCases(tenantId: string, now: number, count: number): SentinelCase[] {
  const cases: SentinelCase[] = [];
  const backgroundDiseases = [
    DISEASE_CATALOG.find(d => d.id === 'tuberculosis')!,
    DISEASE_CATALOG.find(d => d.id === 'typhoid')!,
    DISEASE_CATALOG.find(d => d.id === 'meningitis')!,
    DISEASE_CATALOG.find(d => d.id === 'yellow-fever')!,
  ].filter(Boolean);
  
  for (let i = 0; i < count; i++) {
    const disease = backgroundDiseases[Math.floor(Math.random() * backgroundDiseases.length)];
    const date = new Date(now - Math.random() * 60 * 24 * 60 * 60 * 1000);
    
    cases.push(createCase(tenantId, disease, Math.random() > 0.5 ? 'confirmed' : 'suspected', date.toISOString(), {
      state: NIGERIA_STATES[Math.floor(Math.random() * NIGERIA_STATES.length)],
      lga: 'General',
      facility: 'General Hospital',
      ageGroup: ['0-4', '5-14', '15-44', '45-64', '65+'][Math.floor(Math.random() * 5)],
    }));
  }
  
  return cases;
}

// Helper: Create a single case
function createCase(
  tenantId: string,
  disease: { id: string; name: string; category: 'infectious' | 'ntd' | 'ncd' },
  classification: SentinelCase['classification'],
  reportedAt: string,
  options: {
    state: string;
    lga: string;
    facility: string;
    ageGroup: string;
  }
): SentinelCase {
  return {
    id: `case-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    tenantId,
    diseaseId: disease.id,
    diseaseName: disease.name,
    category: disease.category,
    classification,
    patientRef: `ANON-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    ageGroup: options.ageGroup,
    gender: ['male', 'female', 'unknown'][Math.floor(Math.random() * 3)] as SentinelCase['gender'],
    reportedAt,
    source: ['emr_diagnosis', 'lab_positive', 'community'][Math.floor(Math.random() * 3)] as SentinelCase['source'],
    geo: {
      country: 'Nigeria',
      state: options.state,
      lga: options.lga,
      facilityId: `fac-${options.facility.toLowerCase().replace(/\s+/g, '-')}`,
      facilityName: options.facility,
      coordinates: {
        lat: 6 + Math.random() * 8,
        lng: 3 + Math.random() * 8,
      },
    },
  };
}

// Helper: Create outbreak details
function createOutbreakDetails(
  outbreak: OutbreakCluster,
  cases: SentinelCase[],
  _facilityNames: string[],
  events: { type: OutbreakEvent['type']; desc: string }[]
): OutbreakDetails {
  const facilities = [...new Set(cases.map(c => c.geo.facilityId))];
  
  return {
    ...outbreak,
    timeline: events.map((e, i) => ({
      id: `evt-${outbreak.id}-${i}`,
      date: new Date(new Date(outbreak.startedAt).getTime() + i * 2 * 24 * 60 * 60 * 1000).toISOString(),
      type: e.type,
      description: e.desc,
      actor: e.type === 'detection' ? 'Surveillance System' : 'Outbreak Response Team',
    })),
    affectedFacilities: facilities.map(fid => {
      const facCases = cases.filter(c => c.geo.facilityId === fid);
      return {
        facilityId: fid,
        facilityName: facCases[0]?.geo.facilityName || 'Unknown',
        state: facCases[0]?.geo.state || 'Unknown',
        lga: facCases[0]?.geo.lga || 'Unknown',
        caseCount: facCases.length,
        firstCaseDate: facCases.reduce((min, c) => 
          new Date(c.reportedAt) < new Date(min) ? c.reportedAt : min, facCases[0]?.reportedAt),
        lastCaseDate: facCases.reduce((max, c) => 
          new Date(c.reportedAt) > new Date(max) ? c.reportedAt : max, facCases[0]?.reportedAt),
      };
    }),
    caseList: cases.map(c => c.id),
    investigationTeam: {
      lead: 'Dr. Amina Ibrahim',
      epidemiologist: 'Dr. Chidi Okonkwo',
      labScientist: 'Dr. Fatima Abdullahi',
      assignedAt: outbreak.startedAt,
    },
    controlMeasures: outbreak.recommendedActions.map((action, i) => ({
      id: `cm-${outbreak.id}-${i}`,
      measure: action,
      status: outbreak.status === 'controlled' ? 'completed' : i < 2 ? 'active' : 'planned',
      targetDate: new Date(new Date(outbreak.startedAt).getTime() + (i + 1) * 7 * 24 * 60 * 60 * 1000).toISOString(),
    })),
    riskAssessment: {
      severityScore: outbreak.status === 'active' ? 'high' : outbreak.status === 'watch' ? 'moderate' : 'low',
      confidenceLevel: 0.75 + Math.random() * 0.2,
      factors: [
        `Cases spread across ${outbreak.affectedStates.length} state(s)`,
        `${outbreak.facilityCount} healthcare facilities affected`,
        outbreak.caseCount > 20 ? 'High case volume' : 'Moderate case volume',
      ],
    },
  };
}

// Generate epidemic curve pattern
function generateEpidemicCurve(days: number, min: number, max: number, pattern: 'wave' | 'spike' | 'flat'): number[] {
  const counts: number[] = [];
  
  for (let i = 0; i < days; i++) {
    let base: number;
    
    if (pattern === 'wave') {
      // Sine wave pattern
      base = min + (max - min) * (0.5 + 0.5 * Math.sin((i / days) * Math.PI));
    } else if (pattern === 'spike') {
      // Sharp spike then decline
      base = i < days / 3 ? min + (max - min) * (i / (days / 3)) : 
             max - (max - min) * ((i - days / 3) / (days * 2 / 3));
    } else {
      // Flat with noise
      base = min + (max - min) * 0.3;
    }
    
    // Add noise
    const noise = (Math.random() - 0.5) * (max - min) * 0.3;
    counts.push(Math.max(0, Math.round(base + noise)));
  }
  
  return counts;
}

// Generate AI recommendations based on current data
function generateAIRecommendations(outbreaks: OutbreakCluster[], cases: SentinelCase[]): AIRecommendation[] {
  const recommendations: AIRecommendation[] = [];
  
  // Anomaly detection recommendation
  const choleraOutbreak = outbreaks.find(o => o.diseaseId === 'cholera');
  if (choleraOutbreak) {
    recommendations.push({
      id: `ai-${Date.now()}-1`,
      type: 'outbreak_pattern',
      title: 'Cholera Outburst Pattern Detected',
      description: 'Analysis shows classic waterborne outbreak signature with rapid doubling time. Recommend immediate water source investigation.',
      confidence: 0.91,
      relatedDisease: 'cholera',
      recommendedAction: 'Deploy water quality testing teams to affected LGAs within 24 hours',
      priority: 'critical',
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      acknowledged: false,
    });
  }
  
  // Escalation recommendation
  const activeOutbreaks = outbreaks.filter(o => o.status === 'active');
  if (activeOutbreaks.length >= 2) {
    recommendations.push({
      id: `ai-${Date.now()}-2`,
      type: 'escalation',
      title: 'Multiple Simultaneous Outbreaks',
      description: `${activeOutbreaks.length} active outbreaks detected. Resource allocation strain predicted within 72 hours.`,
      confidence: 0.84,
      recommendedAction: 'Activate Emergency Operations Center and request federal resource deployment',
      priority: 'high',
      createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      acknowledged: false,
    });
  }
  
  // Intervention recommendation based on case velocity
  const recentCases = cases.filter(c => 
    new Date(c.reportedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000
  );
  if (recentCases.length > 50) {
    recommendations.push({
      id: `ai-${Date.now()}-3`,
      type: 'intervention',
      title: 'Surveillance Intensification Recommended',
      description: `Case reporting velocity (${recentCases.length} cases/week) exceeds baseline by 180%. Active case finding recommended.`,
      confidence: 0.79,
      recommendedAction: 'Deploy rapid response teams to high-burden LGAs for active case search',
      priority: 'medium',
      createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
      acknowledged: false,
    });
  }
  
  // Anomaly in specific geography
  const lagosCases = recentCases.filter(c => c.geo.state === 'Lagos');
  if (lagosCases.length > recentCases.length * 0.4) {
    recommendations.push({
      id: `ai-${Date.now()}-4`,
      type: 'anomaly',
      title: 'Geographic Clustering Anomaly: Lagos',
      description: 'Lagos State accounts for disproportionate case burden. Facility capacity monitoring recommended.',
      confidence: 0.87,
      recommendedAction: 'Increase hospital bed capacity monitoring in Lagos facilities',
      priority: 'high',
      createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      acknowledged: false,
    });
  }
  
  return recommendations;
}
