// EMRs in use in Nigerian hospitals and how each can feed VitaLink.
//
//   pull  VitaLink fetches records on a schedule (the EMR has a documented API)
//   push  the EMR (its vendor, or the hospital's IT/integration engine) sends records
//         to VitaLink's endpoint with a push key, as FHIR R4 or simple JSON
//   file  an admin uploads an export (CSV) from the EMR
//
// Commercial EMRs without a published API are listed with push + file: ask the vendor
// to enable FHIR export or a webhook to VitaLink, or export patients to CSV meanwhile.
export type EmrMethod = 'fhir' | 'openmrs' | 'lamisplus' | 'push' | 'file';
export type EmrAuthType = 'none' | 'basic' | 'bearer' | 'oauth2_client' | 'oauth2_password' | 'lamisplus';

export interface EmrSystem {
  key: string;
  name: string;
  vendor: string;
  kind: 'Open source' | 'Commercial' | 'Standard';
  usedFor: string;
  /** Connection methods in order of preference. */
  methods: EmrMethod[];
  /** For pull connections. */
  defaultAuth?: EmrAuthType;
  urlHint?: string;
  setupNote: string;
}

export const EMR_SYSTEMS: EmrSystem[] = [
  {
    key: 'nmrs', name: 'NMRS (Nigeria Medical Record System)', vendor: 'FMoH / implementing partners (OpenMRS)', kind: 'Open source',
    usedFor: 'HIV, TB and PMTCT care in public facilities', methods: ['openmrs', 'push', 'file'], defaultAuth: 'basic',
    urlHint: 'https://nmrs.yourfacility.org/openmrs',
    setupNote: 'Uses the OpenMRS FHIR2 module. Create a dedicated OpenMRS user with view privileges for VitaLink, and expose NMRS over HTTPS (it usually runs on the facility network).',
  },
  {
    key: 'openmrs', name: 'OpenMRS 2.x / 3.x (O3)', vendor: 'OpenMRS community', kind: 'Open source',
    usedFor: 'Teaching and NGO-supported hospitals', methods: ['openmrs', 'push', 'file'], defaultAuth: 'basic',
    urlHint: 'https://emr.yourhospital.org/openmrs',
    setupNote: 'Needs the FHIR2 module (bundled with OpenMRS 3 and recent 2.x reference apps). Sign in with an OpenMRS user that can view patients, encounters and observations.',
  },
  {
    key: 'bahmni', name: 'Bahmni', vendor: 'Bahmni coalition (OpenMRS based)', kind: 'Open source',
    usedFor: 'Hospital EMR with lab (OpenELIS) and billing (Odoo)', methods: ['openmrs', 'push', 'file'], defaultAuth: 'basic',
    urlHint: 'https://bahmni.yourhospital.org/openmrs',
    setupNote: 'Bahmni\'s clinical data lives in its OpenMRS server; connect to that with a Bahmni user that has view privileges.',
  },
  {
    key: 'lamisplus', name: 'LAMISPlus', vendor: 'USAID / Palladium (open source)', kind: 'Open source',
    usedFor: 'HIV programme facilities feeding the National Data Repository', methods: ['lamisplus', 'push', 'file'], defaultAuth: 'lamisplus',
    urlHint: 'https://lamisplus.yourfacility.org',
    setupNote: 'VitaLink signs in with a LAMISPlus user (email and password) and imports patient demographics. Clinical records aren\'t exposed by LAMISPlus\'s public API; push them as FHIR if your partner\'s interoperability layer supports it.',
  },
  {
    key: 'openemr', name: 'OpenEMR', vendor: 'OpenEMR community', kind: 'Open source',
    usedFor: 'Private clinics and hospitals', methods: ['fhir', 'push', 'file'], defaultAuth: 'oauth2_password',
    urlHint: 'https://openemr.yourclinic.ng/apis/default/fhir',
    setupNote: 'In OpenEMR enable the FHIR REST API and OAuth2 password grant (Administration → Config → Connectors), register an API client, and use the FHIR address /apis/default/fhir with token URL /oauth2/default/token and scope "openid api:fhir user/Patient.read user/Observation.read user/Condition.read user/AllergyIntolerance.read user/MedicationRequest.read user/Encounter.read user/Immunization.read user/Procedure.read".',
  },
  {
    key: 'helium', name: 'Helium Health (HeliumOS / HeliumDoc)', vendor: 'Helium Health', kind: 'Commercial',
    usedFor: 'Private hospitals and clinics across Nigeria', methods: ['push', 'fhir', 'file'], defaultAuth: 'bearer',
    setupNote: 'No public API is published. Ask your Helium account manager to send records to VitaLink\'s push endpoint (FHIR R4) or to give you FHIR API access; until then, export patients to CSV.',
  },
  {
    key: 'lafialink', name: 'LafiaLink', vendor: 'Axtute Digital Health', kind: 'Commercial',
    usedFor: 'Private hospitals (low-bandwidth, offline-capable)', methods: ['push', 'file'],
    setupNote: 'Ask Axtute to enable a FHIR or webhook export to VitaLink\'s push endpoint, or export patients to CSV.',
  },
  {
    key: 'clinikehr', name: 'ClinikEHR', vendor: 'ClinikEHR', kind: 'Commercial',
    usedFor: 'Private hospitals and clinics', methods: ['push', 'fhir', 'file'], defaultAuth: 'bearer',
    setupNote: 'Ask ClinikEHR support for FHIR API access or a push integration to VitaLink, or export patients to CSV.',
  },
  {
    key: 'careplus', name: 'CarePlus EMR', vendor: 'CarePlus', kind: 'Commercial',
    usedFor: 'State specialist hospitals', methods: ['push', 'file'],
    setupNote: 'Ask the vendor to push records to VitaLink, or export patients to CSV.',
  },
  {
    key: 'choyom', name: 'Choyom EMR', vendor: 'Choyom', kind: 'Commercial', usedFor: 'Private hospitals (cloud or on-premise)', methods: ['push', 'file'],
    setupNote: 'Ask the vendor to push records to VitaLink, or export patients to CSV.',
  },
  {
    key: 'cliniqueplus', name: 'CliniquePlus EMR', vendor: 'CliniquePlus', kind: 'Commercial', usedFor: 'Private facilities', methods: ['push', 'file'],
    setupNote: 'Ask the vendor to push records to VitaLink, or export patients to CSV.',
  },
  {
    key: 'ajirmed', name: 'AjirMed', vendor: 'AjirMed', kind: 'Commercial', usedFor: 'Hospitals and laboratories (EMR + LIMS)', methods: ['push', 'file'],
    setupNote: 'Ask AjirMed to push records (including lab results) to VitaLink, or export patients to CSV.',
  },
  {
    key: 'mocdoc', name: 'MocDoc HMS', vendor: 'MocDoc', kind: 'Commercial', usedFor: 'Hospital management (EMR, billing, pharmacy)', methods: ['push', 'file'],
    setupNote: 'Ask MocDoc to push records to VitaLink, or export patients to CSV.',
  },
  {
    key: 'carecloud', name: 'CareCloud', vendor: 'CareCloud', kind: 'Commercial', usedFor: 'Cloud EHR for private practice', methods: ['fhir', 'push', 'file'], defaultAuth: 'oauth2_client',
    setupNote: 'CareCloud offers FHIR APIs to its customers: request API credentials (client id and secret) and the FHIR base URL from CareCloud.',
  },
  {
    key: 'medinex', name: 'Medinex', vendor: 'Medinex', kind: 'Commercial', usedFor: 'Shared health record platform', methods: ['push', 'fhir', 'file'], defaultAuth: 'bearer',
    setupNote: 'Ask Medinex for FHIR API access or a push integration to VitaLink.',
  },
  {
    key: 'fhir', name: 'Any FHIR R4 system', vendor: 'HL7 FHIR standard', kind: 'Standard',
    usedFor: 'Any EMR, lab or integration engine with a FHIR R4 API', methods: ['fhir', 'push'], defaultAuth: 'bearer',
    urlHint: 'https://fhir.example.org/r4',
    setupNote: 'Enter the FHIR base address (the one that serves /metadata) and the credentials the system gave you.',
  },
  {
    key: 'other', name: 'Other EMR or spreadsheet', vendor: '—', kind: 'Standard',
    usedFor: 'Any system that can export patients, or records kept in Excel', methods: ['file', 'push'],
    setupNote: 'Upload a CSV export. Columns are matched automatically (name, date of birth, sex, phone, allergies...).',
  },
];

export const METHOD_LABEL: Record<EmrMethod, string> = {
  openmrs: 'Pull from OpenMRS (FHIR)',
  fhir: 'Pull over FHIR R4',
  lamisplus: 'Pull from LAMISPlus',
  push: 'EMR pushes to VitaLink',
  file: 'Upload an export file',
};

export const AUTH_LABEL: Record<EmrAuthType, string> = {
  none: 'No sign-in',
  basic: 'Username and password',
  bearer: 'API token',
  oauth2_client: 'OAuth2 client credentials',
  oauth2_password: 'OAuth2 user sign-in (OpenEMR)',
  lamisplus: 'LAMISPlus user sign-in',
};

export const systemByKey = (key: string) => EMR_SYSTEMS.find((s) => s.key === key) ?? EMR_SYSTEMS[EMR_SYSTEMS.length - 1];
