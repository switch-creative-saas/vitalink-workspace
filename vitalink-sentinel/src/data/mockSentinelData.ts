export type OrganizationType = 'national_agency' | 'ministry' | 'state_ministry' | 'ngo' | 'international' | 'hmo' | 'insurance';
export type Severity = 'critical' | 'high' | 'moderate' | 'low';
export type CaseStatus = 'suspected' | 'confirmed' | 'recovered' | 'deceased';
export type FacilityType = 'hospital' | 'clinic' | 'PHC' | 'lab' | 'community';
export type DiseaseGroup = 'Communicable' | 'NTD' | 'Vector-borne' | 'Respiratory' | 'Waterborne' | 'Zoonotic';

export interface MockOrganization {
  id: string;
  name: string;
  fullName: string;
  type: OrganizationType;
  state: string;
  sector?: string;
  contactEmail?: string;
  contactPhone?: string;
  joinedNetwork?: boolean;
  createdAt?: string;
  subscriptionTier?: 'free' | 'standard' | 'premium';
}

export interface MockOutbreak {
  id: string;
  disease: string;
  state: string;
  lga: string;
  status: 'active' | 'monitoring' | 'resolved';
  severity: Severity;
  casesConfirmed: number;
  casesSuspected: number;
  deaths: number;
  cfr: number;
  startDate: string;
  lastUpdated: string;
  responseTeamDeployed: boolean;
  notes: string;
  coordinates: { lat: number; lng: number };
}

export interface MockCaseReport {
  id: string;
  reportId: string;
  disease: string;
  state: string;
  lga: string;
  facility: string;
  dateReported: string;
  ageGroup: string;
  gender: 'Male' | 'Female' | 'Unknown';
  status: CaseStatus;
  reportedBy: string;
  labConfirmed: boolean;
  symptoms: string[];
}

export interface MockAlert {
  id: string;
  type: 'outbreak_threshold' | 'new_outbreak' | 'facility_silence' | 'mortality_spike';
  severity: Severity;
  title: string;
  message: string;
  state: string;
  disease: string;
  createdAt: string;
  acknowledged: boolean;
  actionRequired: boolean;
}

export interface MockFacility {
  id: string;
  name: string;
  state: string;
  lga: string;
  type: FacilityType;
  lastReport: string;
  reportingFrequency: 'Daily' | 'Weekly' | 'Monthly';
  isActive: boolean;
  contactOfficer: string;
}

export const SentinelColors = {
  sentinelBlue: '#1B3A8F',
  sentinelIndigo: '#3730A3',
  sentinelPurple: '#7C3AED',
  critical: '#DC2626',
  criticalLight: '#FEF2F2',
  high: '#EA580C',
  highLight: '#FFF7ED',
  moderate: '#D97706',
  moderateLight: '#FFFBEB',
  low: '#16A34A',
  lowLight: '#F0FDF4',
  communicable: '#EF4444',
  ntd: '#F97316',
  vectorBorne: '#A855F7',
  respiratory: '#3B82F6',
  waterborne: '#06B6D4',
  zoonotic: '#84CC16',
  bgDark: '#0F1629',
  bgSurface: '#1A2340',
  bgSurfaceLight: '#1E2A4A',
  border: 'rgba(255,255,255,0.08)',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
};

export const mockOrganizations: MockOrganization[] = [
  { id: 'ncdc', name: 'NCDC', fullName: 'Nigeria Centre for Disease Control', type: 'national_agency', state: 'Federal' },
  { id: 'fmoh', name: 'FMOH', fullName: 'Federal Ministry of Health', type: 'ministry', state: 'Federal' },
  { id: 'smoh_lagos', name: 'Lagos SMOH', fullName: 'Lagos State Ministry of Health', type: 'state_ministry', state: 'Lagos' },
  { id: 'smoh_kano', name: 'Kano SMOH', fullName: 'Kano State Ministry of Health', type: 'state_ministry', state: 'Kano' },
  { id: 'tlmn', name: 'TLMN', fullName: 'The Leprosy Mission Nigeria', type: 'ngo', state: 'National' },
  { id: 'who_ng', name: 'WHO Nigeria', fullName: 'World Health Organization - Nigeria', type: 'international', state: 'Federal' },
];

export const diseaseLibrary = [
  { name: 'Lassa Fever', group: 'Communicable', risk: 'critical', description: 'Viral hemorrhagic fever linked to rodent exposure and nosocomial spread.', cases: 148, outbreaks: 4, cfr: '10-20%', symptoms: ['Fever', 'Bleeding', 'Chest pain', 'Vomiting'] },
  { name: 'Cholera', group: 'Waterborne', risk: 'high', description: 'Acute watery diarrhea outbreak risk tied to unsafe water and sanitation gaps.', cases: 1202, outbreaks: 6, cfr: '1-5%', symptoms: ['Watery diarrhea', 'Dehydration', 'Vomiting'] },
  { name: 'Monkeypox', group: 'Zoonotic', risk: 'moderate', description: 'Orthopoxvirus infection monitored through rash illness and exposure clusters.', cases: 72, outbreaks: 2, cfr: '<2%', symptoms: ['Rash', 'Fever', 'Lymph nodes'] },
  { name: 'Meningitis', group: 'Communicable', risk: 'high', description: 'Cerebrospinal meningitis risk across northern meningitis belt states.', cases: 311, outbreaks: 3, cfr: '5-15%', symptoms: ['Fever', 'Neck stiffness', 'Headache'] },
  { name: 'Yellow Fever', group: 'Vector-borne', risk: 'high', description: 'Vaccine-preventable arboviral disease requiring rapid investigation.', cases: 39, outbreaks: 1, cfr: '20-50%', symptoms: ['Jaundice', 'Fever', 'Bleeding'] },
  { name: 'Measles', group: 'Communicable', risk: 'moderate', description: 'Vaccine-preventable rash and fever illness tracked by immunization gaps.', cases: 620, outbreaks: 4, cfr: '1-6%', symptoms: ['Rash', 'Cough', 'Fever'] },
  { name: 'COVID-19', group: 'Respiratory', risk: 'low', description: 'Respiratory viral surveillance for clusters and health worker exposure.', cases: 185, outbreaks: 1, cfr: '<1%', symptoms: ['Cough', 'Fever', 'Anosmia'] },
  { name: 'Typhoid', group: 'Waterborne', risk: 'moderate', description: 'Enteric fever monitoring through clinical and laboratory reporting.', cases: 870, outbreaks: 2, cfr: '<1%', symptoms: ['Fever', 'Abdominal pain', 'Headache'] },
  { name: 'Diphtheria', group: 'Communicable', risk: 'high', description: 'Toxin-mediated vaccine-preventable disease with urgent contact response.', cases: 266, outbreaks: 5, cfr: '5-10%', symptoms: ['Sore throat', 'Neck swelling', 'Fever'] },
  { name: 'Pertussis', group: 'Respiratory', risk: 'moderate', description: 'Whooping cough surveillance for infant and school-linked clusters.', cases: 93, outbreaks: 1, cfr: '<1%', symptoms: ['Paroxysmal cough', 'Vomiting', 'Fever'] },
  { name: 'Leprosy', group: 'NTD', risk: 'moderate', description: 'Long-horizon case finding, disability grading, and treatment coverage tracking.', cases: 421, outbreaks: 0, cfr: 'N/A', symptoms: ['Skin patch', 'Numbness', 'Nerve thickening'] },
  { name: 'Schistosomiasis', group: 'NTD', risk: 'moderate', description: 'Prevalence and mass drug administration tracking in endemic communities.', cases: 2100, outbreaks: 0, cfr: 'N/A', symptoms: ['Hematuria', 'Abdominal pain', 'Fatigue'] },
  { name: 'Lymphatic Filariasis', group: 'NTD', risk: 'low', description: 'MDA coverage and morbidity management intelligence for endemic LGAs.', cases: 545, outbreaks: 0, cfr: 'N/A', symptoms: ['Limb swelling', 'Hydrocele', 'Fever'] },
  { name: 'Onchocerciasis', group: 'NTD', risk: 'low', description: 'River blindness monitoring with ivermectin coverage and vector-risk overlays.', cases: 328, outbreaks: 0, cfr: 'N/A', symptoms: ['Itching', 'Nodules', 'Visual changes'] },
  { name: 'Trachoma', group: 'NTD', risk: 'low', description: 'SAFE strategy surveillance for communities with active trachoma burden.', cases: 211, outbreaks: 0, cfr: 'N/A', symptoms: ['Eye pain', 'Discharge', 'Visual impairment'] },
  { name: 'Soil-transmitted Helminths', group: 'NTD', risk: 'low', description: 'School-age prevalence and deworming coverage monitoring.', cases: 1670, outbreaks: 0, cfr: 'N/A', symptoms: ['Abdominal pain', 'Anemia', 'Poor growth'] },
  { name: 'Malaria', group: 'Vector-borne', risk: 'moderate', description: 'Routine burden intelligence and anomaly detection across reporting sites.', cases: 9020, outbreaks: 1, cfr: '<1%', symptoms: ['Fever', 'Chills', 'Headache'] },
  { name: 'Dengue', group: 'Vector-borne', risk: 'moderate', description: 'Aedes-borne fever surveillance for urban clusters.', cases: 58, outbreaks: 1, cfr: '<1%', symptoms: ['Fever', 'Joint pain', 'Rash'] },
  { name: 'Rift Valley Fever', group: 'Zoonotic', risk: 'high', description: 'Livestock-human spillover monitoring after flooding or animal abortions.', cases: 14, outbreaks: 1, cfr: '1-10%', symptoms: ['Fever', 'Myalgia', 'Bleeding'] },
  { name: 'Tuberculosis', group: 'Respiratory', risk: 'moderate', description: 'Case notification and treatment follow-up intelligence.', cases: 3420, outbreaks: 0, cfr: 'variable', symptoms: ['Cough', 'Weight loss', 'Night sweats'] },
  { name: 'Pneumonia outbreaks', group: 'Respiratory', risk: 'moderate', description: 'Cluster tracking for severe acute respiratory infection signals.', cases: 440, outbreaks: 2, cfr: '2-8%', symptoms: ['Cough', 'Breathlessness', 'Fever'] },
  { name: 'Hepatitis E', group: 'Waterborne', risk: 'moderate', description: 'Waterborne jaundice outbreak detection and pregnancy risk alerts.', cases: 122, outbreaks: 1, cfr: '1-4%', symptoms: ['Jaundice', 'Fever', 'Nausea'] },
  { name: 'Guinea Worm', group: 'NTD', risk: 'low', description: 'Zero-case surveillance and rumor investigation for eradication support.', cases: 0, outbreaks: 0, cfr: 'N/A', symptoms: ['Skin blister', 'Worm emergence', 'Pain'] },
] as const;

export const mockActiveOutbreaks: MockOutbreak[] = [
  { id: 'ob-001', disease: 'Lassa Fever', state: 'Edo', lga: 'Etsako West', status: 'active', severity: 'critical', casesConfirmed: 47, casesSuspected: 83, deaths: 9, cfr: 19.1, startDate: '2026-06-14', lastUpdated: '2026-07-20', responseTeamDeployed: true, notes: 'Cluster linked to rodent exposure in rural farming communities.', coordinates: { lat: 7.09, lng: 6.26 } },
  { id: 'ob-002', disease: 'Cholera', state: 'Borno', lga: 'Maiduguri', status: 'active', severity: 'high', casesConfirmed: 312, casesSuspected: 890, deaths: 14, cfr: 4.5, startDate: '2026-05-28', lastUpdated: '2026-07-19', responseTeamDeployed: true, notes: 'Associated with IDP camp water source contamination.', coordinates: { lat: 11.83, lng: 13.15 } },
  { id: 'ob-003', disease: 'Meningitis', state: 'Sokoto', lga: 'Sokoto North', status: 'monitoring', severity: 'moderate', casesConfirmed: 28, casesSuspected: 45, deaths: 3, cfr: 10.7, startDate: '2026-07-01', lastUpdated: '2026-07-18', responseTeamDeployed: false, notes: 'Dry season increase consistent with meningitis belt pattern.', coordinates: { lat: 13.06, lng: 5.24 } },
  { id: 'ob-004', disease: 'Diphtheria', state: 'Kano', lga: 'Fagge', status: 'active', severity: 'high', casesConfirmed: 64, casesSuspected: 118, deaths: 6, cfr: 9.4, startDate: '2026-07-03', lastUpdated: '2026-07-20', responseTeamDeployed: true, notes: 'Vaccination gap identified in school-age children.', coordinates: { lat: 12.0, lng: 8.52 } },
];

export const mockAlerts: MockAlert[] = [
  { id: 'al-001', type: 'outbreak_threshold', severity: 'critical', title: 'Lassa Fever CFR Exceeds 15% - Edo State', message: 'Case fatality rate for the Edo State Lassa Fever cluster has exceeded the 15% national alert threshold. Immediate response team deployment recommended.', state: 'Edo', disease: 'Lassa Fever', createdAt: '2026-07-20T06:30:00Z', acknowledged: false, actionRequired: true },
  { id: 'al-002', type: 'new_outbreak', severity: 'high', title: 'New Cholera Cluster Detected - Rivers State', message: 'Epidemiological linkage confirmed between 12 new cholera cases in Port Harcourt. Cluster meets outbreak declaration threshold.', state: 'Rivers', disease: 'Cholera', createdAt: '2026-07-19T14:15:00Z', acknowledged: false, actionRequired: true },
  { id: 'al-003', type: 'facility_silence', severity: 'moderate', title: 'Reporting Delay - Zamfara PHC Network', message: 'Nine expected weekly reports are overdue from Zamfara primary health centers.', state: 'Zamfara', disease: 'All conditions', createdAt: '2026-07-19T08:05:00Z', acknowledged: false, actionRequired: false },
  { id: 'al-004', type: 'mortality_spike', severity: 'high', title: 'Mortality Spike in Diphtheria Cluster', message: 'Kano diphtheria deaths increased above the seven-day baseline.', state: 'Kano', disease: 'Diphtheria', createdAt: '2026-07-18T18:30:00Z', acknowledged: true, actionRequired: true },
];

export const mockWeeklyTrend = Array.from({ length: 12 }, (_, index) => ({
  week: `Week ${index + 1}`,
  lassaFever: [12, 14, 16, 18, 21, 25, 28, 35, 41, 47, 52, 56][index],
  cholera: [45, 58, 72, 96, 110, 150, 210, 260, 315, 380, 421, 460][index],
  malaria: [890, 920, 970, 1010, 1080, 1120, 1210, 1300, 1390, 1450, 1510, 1580][index],
  tb: [230, 225, 238, 241, 252, 260, 268, 279, 286, 291, 303, 315][index],
  diphtheria: [8, 11, 15, 19, 24, 29, 34, 42, 50, 57, 63, 71][index],
}));

const states = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];

export const mockStateData = states.map((state, index) => {
  const totalCases = 80 + ((index * 137) % 1450);
  const alerts = index % 6 === 0 ? 3 : index % 4 === 0 ? 2 : index % 3 === 0 ? 1 : 0;
  const riskLevel: Severity = alerts >= 3 ? 'critical' : alerts === 2 ? 'high' : alerts === 1 ? 'moderate' : 'low';
  return { state, activeOutbreaks: alerts > 1 ? alerts - 1 : 0, totalCases, alerts, riskLevel };
});

const facilitySeeds = [
  ['University of Benin Teaching Hospital', 'Edo', 'Oredo', 'hospital'],
  ['Maiduguri IDP Health Post', 'Borno', 'Maiduguri', 'community'],
  ['Aminu Kano Teaching Hospital', 'Kano', 'Tarauni', 'hospital'],
  ['Mainland Hospital Yaba', 'Lagos', 'Yaba', 'hospital'],
  ['Rumuomasi PHC', 'Rivers', 'Port Harcourt', 'PHC'],
  ['Sokoto Specialist Hospital', 'Sokoto', 'Sokoto North', 'hospital'],
  ['Wuse District Hospital', 'FCT', 'Abuja Municipal', 'hospital'],
  ['Adeoyo Maternity Hospital', 'Oyo', 'Ibadan North', 'hospital'],
  ['General Hospital Minna', 'Niger', 'Chanchaga', 'hospital'],
  ['Kafanchan PHC', 'Kaduna', 'Jema’a', 'PHC'],
  ['Bauchi State Lab Network', 'Bauchi', 'Bauchi', 'lab'],
  ['Makurdi Federal Medical Centre', 'Benue', 'Makurdi', 'hospital'],
  ['Abeokuta Central Clinic', 'Ogun', 'Abeokuta South', 'clinic'],
  ['Owerri Disease Program Office', 'Imo', 'Owerri Municipal', 'community'],
  ['Yenagoa Specialist Clinic', 'Bayelsa', 'Yenagoa', 'clinic'],
  ['Damaturu PHC', 'Yobe', 'Damaturu', 'PHC'],
  ['Jalingo General Hospital', 'Taraba', 'Jalingo', 'hospital'],
  ['Birnin Kebbi PHC', 'Kebbi', 'Birnin Kebbi', 'PHC'],
  ['Umuahia Diagnostic Lab', 'Abia', 'Umuahia North', 'lab'],
  ['Akure Infectious Disease Unit', 'Ondo', 'Akure South', 'hospital'],
  ['Jos University Teaching Hospital', 'Plateau', 'Jos North', 'hospital'],
  ['Calabar Community Surveillance Site', 'Cross River', 'Calabar Municipal', 'community'],
] as const;

export const mockFacilities: MockFacility[] = facilitySeeds.map(([name, state, lga, type], index) => ({
  id: `fac-${String(index + 1).padStart(3, '0')}`,
  name,
  state,
  lga,
  type: type as FacilityType,
  lastReport: `2026-07-${String(20 - (index % 12)).padStart(2, '0')}`,
  reportingFrequency: index % 3 === 0 ? 'Daily' : index % 3 === 1 ? 'Weekly' : 'Monthly',
  isActive: index % 7 !== 0,
  contactOfficer: ['Dr. Amina Bello', 'Mr. Chinedu Okafor', 'Mrs. Hauwa Musa', 'Dr. Tunde Adebayo'][index % 4],
}));

const diseases = ['Lassa Fever', 'Cholera', 'Malaria', 'Tuberculosis', 'Diphtheria', 'Measles', 'Leprosy', 'Schistosomiasis', 'Yellow Fever', 'Typhoid'];
const ages = ['0-5', '6-14', '15-29', '30-49', '50-64', '65+'];
const statuses: CaseStatus[] = ['suspected', 'confirmed', 'recovered', 'deceased'];

export const mockRecentCases: MockCaseReport[] = Array.from({ length: 56 }, (_, index) => {
  const facility = mockFacilities[index % mockFacilities.length];
  const disease = diseases[index % diseases.length];
  return {
    id: `case-${String(index + 1).padStart(3, '0')}`,
    reportId: `SEN-2026-${String(1001 + index)}`,
    disease,
    state: facility.state,
    lga: facility.lga,
    facility: facility.name,
    dateReported: `2026-07-${String(20 - (index % 18)).padStart(2, '0')}`,
    ageGroup: ages[index % ages.length],
    gender: index % 5 === 0 ? 'Unknown' : index % 2 === 0 ? 'Female' : 'Male',
    status: statuses[index % statuses.length],
    reportedBy: facility.name,
    labConfirmed: index % 3 !== 0,
    symptoms: diseaseLibrary.find((d) => d.name === disease)?.symptoms.slice(0, 3) ?? ['Fever'],
  };
});

export const diseaseDistribution = [
  { name: 'Communicable', value: 34, color: SentinelColors.communicable },
  { name: 'NTD', value: 18, color: SentinelColors.ntd },
  { name: 'Vector-borne', value: 29, color: SentinelColors.vectorBorne },
  { name: 'Respiratory', value: 12, color: SentinelColors.respiratory },
  { name: 'Waterborne', value: 7, color: SentinelColors.waterborne },
];
