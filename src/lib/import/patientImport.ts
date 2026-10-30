// Smart patient import. Takes whatever a hospital already has (a spreadsheet from another EMR,
// a typed-up register, a CSV export, FHIR JSON, HL7 v2 messages, or a photographed register page
// read by ocrRegister.ts) and turns it into VitaLink patients without anyone reformatting it:
//
// - finds the header row wherever it is (title lines above it are skipped) and the best sheet;
// - matches columns by meaning, from a vocabulary of the headings used by EMRs (OpenMRS, DHIS2
//   tracker, Epic/Cerner exports, Helium/other Nigerian EMRs), NHIA enrollee lists, the NHMIS
//   OPD register and ordinary paper registers; columns with no clear heading are recognised by
//   their contents (M/F, phone numbers, dates, emails);
// - cleans values: one "Patient Name" column is split (titles dropped, "SURNAME, First" handled),
//   "Not recorded"/"N/A"/"-" become blank, phones get their lost leading 0 back, blood groups and
//   genotypes are tidied, dates are read day-first unless the data says otherwise;
// - with only an age (34, 34y, 6/12 for six months, 18m, 3/52 for weeks) or an NHMIS age-band
//   tick, works out a birth date counted back from the visit or registration date on that row
//   (an age written in 2004 is from 2004), and marks it estimated;
// - keeps the old card / hospital / file number, so the patient can still be found by it and
//   importing the same file twice doesn't create duplicates. Every patient gets a VitaLink ID.
import { readXlsx, type Sheet } from './xlsx';

export type { Sheet };

export type FieldKey =
  | 'fullName' | 'firstName' | 'middleName' | 'lastName' | 'dateOfBirth' | 'age' | 'ageMonths' | 'sex' | 'maleTick' | 'femaleTick'
  | 'phone' | 'email' | 'address' | 'town' | 'state' | 'country' | 'occupation' | 'maritalStatus' | 'nationalId'
  | 'bloodGroup' | 'genotype' | 'allergies' | 'chronicConditions' | 'currentMedications'
  | 'emergencyContactName' | 'emergencyRelationship' | 'emergencyPhone' | 'emergencyAddress'
  | 'insuranceProvider' | 'insurancePolicyNumber' | 'insuranceType' | 'insuranceExpiryDate'
  | 'previousNumber' | 'referenceDate' | 'status' | 'department' | 'doctorAssigned' | 'ageBand';

export const FIELD_LABELS: Record<FieldKey, string> = {
  fullName: 'Full name', firstName: 'First name', middleName: 'Middle name', lastName: 'Surname', dateOfBirth: 'Date of birth',
  age: 'Age (years)', ageMonths: 'Age (months)', sex: 'Sex', maleTick: 'Male (tick)', femaleTick: 'Female (tick)', phone: 'Phone', email: 'Email',
  address: 'Address', town: 'Town / LGA', state: 'State', country: 'Country', occupation: 'Occupation', maritalStatus: 'Marital status',
  nationalId: 'NIN / national ID', bloodGroup: 'Blood group', genotype: 'Genotype', allergies: 'Allergies', chronicConditions: 'Conditions',
  currentMedications: 'Current medicines', emergencyContactName: 'Next of kin', emergencyRelationship: 'Next of kin relationship',
  emergencyPhone: 'Next of kin phone', emergencyAddress: 'Next of kin address', insuranceProvider: 'HMO / insurer', insurancePolicyNumber: 'Enrollee / policy no.',
  insuranceType: 'Payment type', insuranceExpiryDate: 'Insurance expiry', previousNumber: 'Old card / hospital no.',
  referenceDate: 'Visit / registration date', status: 'Status', department: 'Department / clinic', doctorAssigned: 'Doctor', ageBand: 'Age group (tick)',
};

// Headings seen in the wild, normalised (lower case, punctuation as spaces). Longer phrases win,
// so "emergency phone" beats "phone" and "date of birth" beats "date".
const SYNONYMS: Record<Exclude<FieldKey, 'ageBand'>, string[]> = {
  fullName: ['name', 'patient name', 'patients name', 'full name', 'name of patient', 'client name', 'clients name', 'names', 'patient', 'patient full name', 'name surname first', 'surname first name', 'surname and other names', 'name in full', 'beneficiary name', 'enrollee name', 'person name', 'display name'],
  firstName: ['first name', 'firstname', 'given name', 'given names', 'forename', 'forenames', 'other name', 'other names', 'fname', 'first', 'given', 'christian name', 'name first'],
  middleName: ['middle name', 'middlename', 'middle', 'mname', 'second name', 'middle initial'],
  lastName: ['last name', 'lastname', 'surname', 'family name', 'lname', 'last', 'family', 'sur name', 'name last'],
  dateOfBirth: ['date of birth', 'dob', 'd o b', 'birth date', 'birthdate', 'birthday', 'born', 'date born', 'birth', 'dateofbirth', 'birth date yyyy mm dd'],
  age: ['age', 'age years', 'age yrs', 'age in years', 'age yr', 'years', 'yrs', 'age y', 'patient age', 'age at visit', 'current age'],
  ageMonths: ['age months', 'age in months', 'months', 'age mths', 'age mo'],
  sex: ['sex', 'gender', 'sex m f', 'm f', 'gender m f', 'sex gender', 'administrative sex', 'sex at birth', 'gender identity'],
  maleTick: ['male', 'males'],
  femaleTick: ['female', 'females'],
  phone: ['phone', 'phone number', 'phone no', 'telephone', 'tel', 'tel no', 'mobile', 'mobile number', 'mobile no', 'gsm', 'gsm no', 'contact', 'contact number', 'contact no', 'cell', 'cell phone', 'phone 1', 'primary phone', 'patient phone', 'whatsapp', 'telecom'],
  email: ['email', 'e mail', 'email address', 'mail'],
  address: ['address', 'home address', 'residential address', 'residence', 'street', 'street address', 'address line 1', 'address 1', 'contact address', 'house address', 'location', 'settlement', 'village', 'community', 'ward', 'area', 'area city', 'locality', 'address line'],
  town: ['town', 'city', 'lga', 'l g a', 'local government', 'local government area', 'district', 'town city', 'city town'],
  state: ['state', 'state of residence', 'state fct', 'region', 'province', 'county', 'state province'],
  country: ['country', 'nationality'],
  occupation: ['occupation', 'job', 'profession', 'work', 'employment', 'trade'],
  maritalStatus: ['marital status', 'marital', 'married', 'civil status', 'marriage status'],
  nationalId: ['nin', 'national id', 'national identification number', 'national id number', 'nin no', 'nin number', 'identity number', 'id number', 'ssn', 'bvn'],
  bloodGroup: ['blood group', 'blood type', 'bloodgroup', 'bg', 'abo', 'blood grp', 'abo rh', 'blood group rh'],
  genotype: ['genotype', 'hb genotype', 'hemoglobin genotype', 'haemoglobin genotype', 'hb type', 'sickling status'],
  allergies: ['allergies', 'allergy', 'known allergies', 'drug allergies', 'drug allergy', 'allergic to', 'allergies reactions'],
  chronicConditions: ['chronic conditions', 'chronic condition', 'conditions', 'medical conditions', 'medical history', 'past medical history', 'pmh', 'comorbidities', 'comorbidity', 'chronic illness', 'chronic diseases', 'existing conditions', 'problem list', 'known conditions', 'underlying conditions'],
  currentMedications: ['current medications', 'medications', 'current medicines', 'medicines', 'drugs', 'current drugs', 'drug history', 'regular medications'],
  emergencyContactName: ['emergency contact', 'emergency contact name', 'next of kin', 'nok', 'next of kin name', 'nok name', 'kin', 'guardian', 'parent guardian', 'caregiver', 'parent', 'parent name', 'mother name', 'father name', 'relative name', 'emergency name', 'contact person', 'name of next of kin'],
  emergencyRelationship: ['emergency relationship', 'relationship', 'nok relationship', 'next of kin relationship', 'relationship to patient', 'relation', 'kin relationship', 'emergency contact relationship'],
  emergencyPhone: ['emergency phone', 'emergency contact phone', 'emergency number', 'nok phone', 'next of kin phone', 'nok phone number', 'next of kin phone number', 'next of kin number', 'nok number', 'nok tel', 'guardian phone', 'parent phone', 'emergency contact number', 'emergency tel', 'kin phone'],
  emergencyAddress: ['emergency address', 'nok address', 'next of kin address', 'guardian address', 'emergency contact address'],
  insuranceProvider: ['hmo', 'insurance', 'insurance provider', 'insurer', 'payer', 'payer scheme', 'scheme', 'health plan', 'hmo name', 'insurance company', 'nhis', 'nhia', 'sponsor', 'plan', 'provider hmo', 'health insurance'],
  insurancePolicyNumber: ['member id', 'member number', 'enrollee id', 'enrollee number', 'enrolee id', 'enrolee no', 'enrollee no', 'policy number', 'policy no', 'insurance number', 'insurance no', 'insurance id', 'hmo id', 'hmo number', 'nhis number', 'nhis no', 'nhia number', 'nhia no', 'membership number', 'subscriber id', 'beneficiary id', 'scheme number'],
  insuranceType: ['coverage', 'payment type', 'payment mode', 'payment method', 'billing type', 'patient type', 'category', 'payment category', 'pay type', 'self pay', 'coverage type', 'financial class'],
  insuranceExpiryDate: ['insurance expiry', 'expiry date', 'policy expiry', 'coverage end', 'valid until', 'expiry'],
  previousNumber: ['old number', 'old no', 'old card number', 'previous number', 'previous id', 'legacy id', 'legacy number', 'patient id', 'patient no', 'patient number', 'card no', 'card number', 'hospital no', 'hospital number', 'hosp no', 'mrn', 'medical record number', 'record number', 'record no', 'file no', 'file number', 'folder no', 'folder number', 'reg no', 'registration number', 'registration no', 'op no', 'opd no', 'unit no', 'unit number', 'pid', 'chart no', 'chart number', 'case no', 'case number', 'hospital id', 'patient identifier', 'identifier', 'emr id', 'ehr id', 'client id', 'client number', 'unique id', 'patient code', 'art no', 'anc no', 'clinic no', 'id'],
  referenceDate: ['date', 'visit date', 'date of visit', 'registration date', 'date registered', 'reg date', 'date of registration', 'encounter date', 'attendance date', 'date seen', 'admission date', 'date of admission', 'created', 'created at', 'created on', 'date created', 'enrollment date', 'enrolment date', 'first visit'],
  status: ['status', 'patient status', 'admission status', 'state of patient'],
  department: ['department', 'clinic', 'unit', 'ward name', 'specialty', 'service', 'dept'],
  doctorAssigned: ['doctor', 'consultant', 'physician', 'attending', 'clinician', 'doctor assigned', 'seen by', 'attending physician', 'provider'],
};

const norm = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+<>≥]+/g, ' ').trim();

// NHMIS-style age-group tick columns ("<1", "1-4", "5-9", "0-28 days", "29d-11m", "12-59m", "20+").
function ageBandMidpoint(header: string): number | null {
  const h = header.toLowerCase().replace(/\s+/g, '').replace(/yrs?|years?/g, '');
  const unit = (s: string) => (/d(ays?)?$/.test(s) ? 1 / 365 : /m(ths?|onths?|o)?$/.test(s) ? 1 / 12 : /w(ks?|eeks?)?$/.test(s) ? 7 / 365 : 1);
  const num = (s: string) => parseFloat(s);
  let m = h.match(/^(\d+)([a-z]*)[-–to]+(\d+)([a-z]*)$/);
  if (m) {
    const hiUnit = unit(m[4] || m[2]);
    const loUnit = m[2] ? unit(m[2]) : hiUnit;
    return (num(m[1]) * loUnit + num(m[3]) * hiUnit) / 2;
  }
  if ((m = h.match(/^(?:<|under|below)(\d+)([a-z]*)$/))) return (num(m[1]) * unit(m[2])) / 2;
  if ((m = h.match(/^(?:≥|>=|>|over|above)?(\d+)([a-z]*)(?:\+|andabove|&above|plus)$/)) || (m = h.match(/^(?:≥|>=)(\d+)([a-z]*)$/))) return num(m[1]) * unit(m[2]) + 10;
  return null;
}

function matchHeader(header: string): { field: FieldKey; score: number } | null {
  const h = norm(header);
  if (!h) return null;
  if (ageBandMidpoint(header) !== null && /\d/.test(h)) return { field: 'ageBand', score: 1 };
  let best: { field: FieldKey; score: number } | null = null;
  for (const [field, words] of Object.entries(SYNONYMS) as Array<[FieldKey, string[]]>) {
    for (const word of words) {
      let score = 0;
      if (h === word) score = 100 + word.length;
      else if (` ${h} `.includes(` ${word} `)) score = word.length; // the phrase inside a longer heading
      if (score > (best?.score ?? 0)) best = { field, score };
    }
  }
  // "Age (months)" is months even though it contains "age".
  if (best?.field === 'age' && /\b(months?|mths?|mo)\b/.test(h)) return { field: 'ageMonths', score: best.score + 50 };
  return best;
}

export interface ColumnMap { index: number; header: string; field: FieldKey | null; guessed?: boolean }

export interface Detected {
  sheet: string;
  headerRow: number; // 0-based in the sheet
  columns: ColumnMap[];
  body: string[][];
  score: number;
}

const PATIENT_FIELDS = new Set<FieldKey>(['fullName', 'firstName', 'lastName', 'dateOfBirth', 'age', 'sex', 'phone', 'previousNumber', 'address', 'emergencyContactName', 'bloodGroup', 'genotype', 'ageBand', 'maleTick', 'femaleTick']);

function mapHeaders(headers: string[]): ColumnMap[] {
  const matches = headers.map((header, index) => ({ index, header, m: matchHeader(header) }));
  // One column per field, except age bands; the best-scoring heading keeps it.
  const taken = new Map<FieldKey, number>();
  for (const { index, m } of matches) {
    if (!m || m.field === 'ageBand') continue;
    const other = taken.get(m.field);
    if (other === undefined || (matches[other].m?.score ?? 0) < m.score) taken.set(m.field, index);
  }
  return matches.map(({ index, header, m }) => ({
    index,
    header: header.trim(),
    field: m && (m.field === 'ageBand' || taken.get(m.field) === index) ? m.field : null,
  }));
}

/** Finds the heading row (skipping title lines) and the sheet that looks most like a patient list. */
export function detect(sheets: Sheet[]): Detected | null {
  let best: Detected | null = null;
  for (const sheet of sheets) {
    const limit = Math.min(sheet.rows.length, 40);
    for (let r = 0; r < limit; r += 1) {
      const cells = sheet.rows[r] ?? [];
      if (cells.filter((c) => c?.trim()).length < 2) continue;
      const columns = mapHeaders(cells.map((c) => c ?? ''));
      const fields = columns.filter((c) => c.field && PATIENT_FIELDS.has(c.field)).length;
      const hasName = columns.some((c) => c.field === 'fullName' || c.field === 'firstName' || c.field === 'lastName');
      const body = sheet.rows.slice(r + 1).filter((row) => row?.some((c) => c?.trim()));
      const score = fields * 10 + (hasName ? 25 : 0) + Math.min(body.length, 50) / 10;
      if (fields >= 2 && score > (best?.score ?? 0)) best = { sheet: sheet.name, headerRow: r, columns, body, score };
    }
  }
  if (best) sniffColumns(best);
  if (!best) {
    // No headings at all: look at the contents instead.
    const sheet = sheets.find((s) => s.rows.some((row) => row?.some((c) => c?.trim())));
    if (!sheet) return null;
    const width = Math.max(...sheet.rows.map((r) => r?.length ?? 0));
    const columns = Array.from({ length: width }, (_, index) => ({ index, header: `Column ${index + 1}`, field: null as FieldKey | null }));
    best = { sheet: sheet.name, headerRow: -1, columns, body: sheet.rows.filter((row) => row?.some((c) => c?.trim())), score: 0 };
    sniffColumns(best);
  }
  return best;
}

const SERIAL = /^(s ?n|s no|sl no|serial( no| number)?|no|nos|number|#|index|row|count|line)$/;

/** Recognises columns without a clear heading by what is in them. */
function sniffColumns(d: Detected) {
  const used = new Set(d.columns.map((c) => c.field).filter(Boolean));
  const sample = (index: number) => d.body.slice(0, 200).map((row) => (row[index] ?? '').trim()).filter((v) => v && !isPlaceholder(v));
  const share = (values: string[], test: (v: string) => boolean) => (values.length ? values.filter(test).length / values.length : 0);
  const hasBands = d.columns.some((c) => c.field === 'ageBand');
  for (const column of d.columns) {
    if (column.field || SERIAL.test(norm(column.header))) continue;
    const values = sample(column.index);
    if (values.length < 2) continue;
    // 1, 2, 3 … is a serial number, never an age.
    if (values.every((v, i) => i === 0 || Number(v) === Number(values[i - 1]) + 1)) continue;
    let guess: FieldKey | null = null;
    if (!used.has('sex') && share(values, (v) => parseSex(v) !== null) > 0.85) guess = 'sex';
    else if (!used.has('email') && share(values, (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) > 0.8) guess = 'email';
    else if (!used.has('phone') && share(values, (v) => /^\+?[\d\s()-]{10,16}$/.test(v) && /^(\+?234|0)?[789][01]\d{8}$/.test(v.replace(/[^\d+]/g, ''))) > 0.8) guess = 'phone';
    else if (!used.has('bloodGroup') && share(values, (v) => normaliseBloodGroup(v) !== '') > 0.85) guess = 'bloodGroup';
    else if (!used.has('genotype') && share(values, (v) => /^(aa|as|ss|ac|sc|cc)$/i.test(v.trim())) > 0.85) guess = 'genotype';
    else if (!used.has('dateOfBirth') && !used.has('age') && share(values, (v) => {
      const iso = parseDate(v, true);
      return Boolean(iso) && Number(iso!.slice(0, 4)) < new Date().getFullYear() - 1;
    }) > 0.8) guess = 'dateOfBirth';
    else if (!hasBands && !used.has('age') && !used.has('dateOfBirth') && share(values, (v) => parseAge(v) !== null) > 0.9 && share(values, (v) => /^\d{1,3}$/.test(v)) > 0.5) guess = 'age';
    else if (!used.has('fullName') && !used.has('firstName') && share(values, (v) => /^[A-Za-zÀ-ÿ'’.-]+(?:[ ,]+[A-Za-zÀ-ÿ'’.-]+){1,4}$/.test(v)) > 0.8) guess = 'fullName';
    if (guess) { column.field = guess; column.guessed = true; used.add(guess); }
  }
}

// ---------- value cleaning ----------

const PLACEHOLDER = /^(n\/?a|nil|null|none|nan|not (supplied|recorded|applicable|available|known|provided|stated|given|captured|specified)|unknown|unk|undefined|-+|–|—|\?+|\.+|x+|tbd|pending|na|not on file|no data|blank)$/i;
export const isPlaceholder = (value: string) => PLACEHOLDER.test(value.trim());
const clean = (value: string | undefined) => {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  return isPlaceholder(v) ? '' : v;
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function validIso(y: number, m: number, d: number) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (y < 1880 || date.getTime() > Date.now() + 86_400_000 * 366) return null;
  return date.toISOString().slice(0, 10);
}

const fullYear = (y: number) => {
  if (y >= 100) return y;
  const now = new Date().getFullYear() % 100;
  return y > now ? 1900 + y : 2000 + y;
};

/** Reads a date written almost any way. dayFirst decides 03/04/2010 (Nigeria and the UK: 3 April). */
export function parseDate(raw: string, dayFirst: boolean): string | null {
  const v = raw.trim().replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/,/g, ' ');
  if (!v) return null;
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return validIso(+m[1], +m[2], +m[3]);
  if ((m = v.match(/^(\d{4})(\d{2})(\d{2})$/))) return validIso(+m[1], +m[2], +m[3]); // HL7 / compact
  if ((m = v.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{2}|\d{4})$/))) {
    const [a, b, y] = [+m[1], +m[2], fullYear(+m[3])];
    if (a > 12) return validIso(y, b, a);
    if (b > 12) return validIso(y, a, b);
    return dayFirst ? validIso(y, b, a) : validIso(y, a, b);
  }
  if ((m = v.match(/^(\d{1,2})[-/.\s]+([a-z]{3,9})\.?[-/.\s]+(\d{2}|\d{4})$/i)) && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    return validIso(fullYear(+m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  }
  if ((m = v.match(/^([a-z]{3,9})\.?\s+(\d{1,2})\s+(\d{2}|\d{4})$/i)) && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    return validIso(fullYear(+m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  }
  // Excel day numbers that arrived as plain numbers (CSV saved from Excel).
  if (/^\d{4,5}(\.\d+)?$/.test(v) && +v > 3000 && +v < 80_000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(+v) * 86_400_000).toISOString().slice(0, 10);
  }
  if ((m = v.match(/^(?:c\.?|circa|about)?\s*(\d{4})$/i))) return validIso(+m[1], 7, 1); // year only
  return null;
}

/** Age in years from "34", "34y", "34 yrs", "6/12" (6 months), "3/52" (weeks), "5/7" (days), "18m", "1y 6m". */
export function parseAge(raw: string): number | null {
  const v = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!v || !/\d/.test(v)) return null;
  const clinical = v.match(/^(\d{1,2})\s*\/\s*(12|52|7|365)$/); // 6/12 = six months, 3/52 = three weeks
  if (clinical) return +clinical[1] / +clinical[2];
  const UNIT: Record<string, number> = {
    '': 1, y: 1, yr: 1, yrs: 1, year: 1, years: 1, yo: 1, m: 1 / 12, mo: 1 / 12, mos: 1 / 12, mth: 1 / 12, mths: 1 / 12, month: 1 / 12, months: 1 / 12,
    w: 7 / 365, wk: 7 / 365, wks: 7 / 365, week: 7 / 365, weeks: 7 / 365, d: 1 / 365, dy: 1 / 365, dys: 1 / 365, day: 1 / 365, days: 1 / 365,
  };
  let years = 0;
  let rest = v;
  for (const [whole, n, unit] of v.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]*)/g)) {
    if (!(unit in UNIT)) return null;
    years += +n * UNIT[unit];
    rest = rest.replace(whole, ' ');
  }
  if (rest.replace(/\b(old|and)\b|[+,&\s]/g, '')) return null; // other words: not an age
  return years >= 0 && years < 125 ? years : null;
}

export function parseSex(raw: string): 'male' | 'female' | 'other' | null {
  const v = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!v) return null;
  if (/^(m|male|man|boy|males|masculine|mr|namiji|ako|nwoke|mm)$/.test(v)) return 'male';
  if (/^(f|female|woman|girl|females|feminine|w|mace|abo|nwanyi|ff)$/.test(v)) return 'female';
  if (/^(o|other|intersex|x|nonbinary)$/.test(v)) return 'other';
  return null;
}

const TITLES = /^(mr|mrs|miss|ms|mst|master|dr|doc|prof|chief|alhaji|alh|alhaja|hajia|hajiya|mallam|malam|pastor|pst|rev|revd|engr|barr|arc|hon|sir|lady|madam|mdm|bro|sis|elder|deacon|deaconess|evang|oba|baale|prince|princess|hrh|col|capt|maj|gen|lt|sgt|cpl|baby|bb|infant|b\/o|bo)\.?$/i;

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (_, p, c) => p + c.toUpperCase());

/** "OKAFOR, Chinedu Emeka", "Dr. Amina Yusuf", "OKAFOR Chinedu", "Baby of Grace Eze" → parts. */
export function splitName(raw: string): { firstName: string; middleName: string; lastName: string } {
  let v = raw.replace(/\s+/g, ' ').replace(/[“”"]/g, '').trim();
  const babyOf = v.match(/^(baby|b\/o|bo)\s+(of\s+)?(.*)$/i);
  if (babyOf) v = babyOf[3];
  if (v.includes(',')) {
    const [last, rest] = v.split(',', 2).map((s) => s.trim());
    const given = rest.split(' ').filter((w) => w && !TITLES.test(w));
    return { firstName: titleCase(given[0] ?? ''), middleName: titleCase(given.slice(1).join(' ')), lastName: titleCase(last) };
  }
  const words = v.split(' ').filter((w) => w && !TITLES.test(w));
  if (words.length === 0) return { firstName: '', middleName: '', lastName: '' };
  if (words.length === 1) return { firstName: titleCase(words[0]), middleName: '', lastName: '' };
  // Surname written first in capitals: "OKAFOR Chinedu Emeka".
  const caps = (w: string) => w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w);
  if (caps(words[0]) && !words.slice(1).every(caps)) {
    return { firstName: titleCase(words[1]), middleName: titleCase(words.slice(2).join(' ')), lastName: titleCase(words[0]) };
  }
  return { firstName: titleCase(words[0]), middleName: titleCase(words.slice(1, -1).join(' ')), lastName: titleCase(words[words.length - 1]) };
}

export function normalisePhone(raw: string): string {
  const v = clean(raw);
  if (!v) return '';
  const first = v.split(/[/,;]| or /i)[0];
  let digits = first.replace(/[^\d+]/g, '');
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(first.trim())) digits = String(Math.round(Number(first))); // 8.03E+09 from Excel
  if (/^[789][01]\d{8}$/.test(digits)) return `0${digits}`; // Excel dropped the leading 0
  if (/^234[789][01]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^00\d+/.test(digits)) return `+${digits.slice(2)}`;
  return digits.length >= 7 ? digits : '';
}

export function normaliseBloodGroup(raw: string): string {
  const v = raw.toUpperCase().replace(/\s+/g, '').replace(/RH/g, '').replace(/POS(ITIVE)?|\(\+\)|VE\+|\+VE/g, '+').replace(/NEG(ATIVE)?|\(-\)|VE-|-VE/g, '-');
  const m = v.match(/^(AB|A|B|O|0)([+-])$/);
  return m ? `${m[1] === '0' ? 'O' : m[1]}${m[2]}` : '';
}

const normaliseGenotype = (raw: string) => (/^(aa|as|ss|ac|sc|cc)$/i.test(raw.replace(/\s+/g, '')) ? raw.replace(/\s+/g, '').toUpperCase() : clean(raw));

function normaliseAllergies(raw: string) {
  const v = raw.trim();
  if (/^(nkda|nka|nkfa|no known (drug )?allerg(y|ies)|nil( known)?|none( known)?|no allerg(y|ies)|no)$/i.test(v)) return 'No known allergies';
  return clean(v).replace(/\s*\((reported|self reported|confirmed)\)/gi, '');
}

const STATUS: Record<string, 'active' | 'inpatient' | 'outpatient' | 'discharged' | 'referred'> = {
  active: 'active', inpatient: 'inpatient', admitted: 'inpatient', 'in patient': 'inpatient', ipd: 'inpatient', outpatient: 'outpatient',
  opd: 'outpatient', 'out patient': 'outpatient', discharged: 'discharged', referred: 'referred', 'referred out': 'referred',
};

// ---------- rows ----------

export interface ImportPatient {
  firstName: string; middleName: string; lastName: string; dateOfBirth: string; dobEstimated: boolean;
  gender: '' | 'male' | 'female' | 'other'; phone: string; email: string; address: string; state: string; country: string;
  occupation: string; maritalStatus: string; nationalId: string; bloodGroup: string; genotype: string; allergies: string;
  chronicConditions: string; currentMedications: string; emergencyContactName: string; emergencyRelationship: string;
  emergencyPhone: string; emergencyAddress: string; insuranceProvider: string; insurancePolicyNumber: string; insuranceType: string;
  insuranceExpiryDate: string; previousNumber: string; status: 'active' | 'inpatient' | 'outpatient' | 'discharged' | 'referred';
  department: string; doctorAssigned: string;
}

export interface ImportRow {
  key: string;
  line: number; // row number in the sheet (1-based), for "row 12" messages
  include: boolean;
  patient: ImportPatient;
  ageText: string; // what the file said, shown next to an estimated birth date
  uncertain: Array<keyof ImportPatient>; // highlighted for checking (scanned pages)
  duplicateOf?: number; // line of an earlier row in this file
}

/** What still stops a row from being registered. */
export function rowProblems(p: ImportPatient): string[] {
  const out: string[] = [];
  if (!p.firstName) out.push('first name');
  if (!p.lastName) out.push('surname');
  if (!p.dateOfBirth) out.push('date of birth or age');
  if (!p.gender) out.push('sex');
  return out;
}

// The heading row printed again on a new page: most cells are exactly their column's heading.
const looksLikeHeaderAgain = (row: string[], columns: ColumnMap[]) => {
  const mapped = columns.filter((c) => c.field);
  const same = mapped.filter((c) => norm(row[c.index] ?? '') === norm(c.header)).length;
  return mapped.length > 0 && same >= Math.max(2, mapped.length / 2);
};

/** dd/mm vs mm/dd for a whole column: decided by the values themselves. */
function dayFirstFor(values: string[]) {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/);
    if (!m) continue;
    if (+m[1] > 12) dayFirst += 1;
    if (+m[2] > 12) monthFirst += 1;
  }
  return monthFirst <= dayFirst; // day first unless the data clearly says otherwise
}

function subtractYears(isoDate: string, years: number) {
  const ref = new Date(`${isoDate}T00:00:00Z`);
  // Whole years: put the birthday half a year back, the middle of the possible range.
  const days = Number.isInteger(years) ? years * 365.25 + 182 : years * 365.25;
  return new Date(ref.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export function buildRows(d: Detected, uncertainCells?: Map<string, Set<number>>): ImportRow[] {
  const col = (field: FieldKey) => d.columns.find((c) => c.field === field)?.index;
  const bands = d.columns.filter((c) => c.field === 'ageBand').map((c) => ({ index: c.index, age: ageBandMidpoint(c.header) ?? 30 }));
  const get = (row: string[], field: FieldKey) => {
    const i = col(field);
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
  const dobDayFirst = dayFirstFor(d.body.map((r) => get(r, 'dateOfBirth')));
  const refDayFirst = dayFirstFor(d.body.map((r) => get(r, 'referenceDate')));
  const today = new Date().toISOString().slice(0, 10);
  const firstSeen = new Map<string, number>();
  const rows: ImportRow[] = [];

  d.body.forEach((row, i) => {
    if (looksLikeHeaderAgain(row, d.columns)) return; // repeated heading on a new page
    const nameRaw = get(row, 'fullName');
    if (/^(total|grand total|sub ?total|summary|page \d+)/i.test(nameRaw) || /^(total|grand total)\b/i.test((row[0] ?? '').trim())) return;
    const line = d.headerRow + 2 + i;

    const fromFull = nameRaw ? splitName(clean(nameRaw)) : { firstName: '', middleName: '', lastName: '' };
    const first = clean(get(row, 'firstName'));
    const last = clean(get(row, 'lastName'));
    // "First name" sometimes holds "Chinedu Emeka": the extra words are middle names.
    const firstSplit = first && !last && !nameRaw ? splitName(first) : null;
    const firstWords = first.split(' ');
    const names = firstSplit ?? {
      firstName: first ? titleCase(firstWords[0]) : fromFull.firstName,
      middleName: clean(get(row, 'middleName')) ? titleCase(clean(get(row, 'middleName'))) : first ? titleCase(firstWords.slice(1).join(' ')) : fromFull.middleName,
      lastName: last ? titleCase(last) : fromFull.lastName,
    };

    const sexRaw = get(row, 'sex');
    let gender: ImportPatient['gender'] = parseSex(sexRaw) ?? '';
    if (!gender && (col('maleTick') !== undefined || col('femaleTick') !== undefined)) {
      if (clean(get(row, 'maleTick'))) gender = 'male';
      else if (clean(get(row, 'femaleTick'))) gender = 'female';
    }

    const reference = parseDate(get(row, 'referenceDate'), refDayFirst) ?? today;
    let dateOfBirth = parseDate(get(row, 'dateOfBirth'), dobDayFirst) ?? '';
    let dobEstimated = false;
    let ageText = '';
    if (!dateOfBirth) {
      const ageRaw = get(row, 'age') || get(row, 'dateOfBirth'); // "34 yrs" typed in a DOB column
      const months = get(row, 'ageMonths');
      let years = ageRaw ? parseAge(ageRaw) : null;
      if (months && parseAge(months) !== null) years = (years ?? 0) + (parseAge(months) as number) / 12 * (/[a-z/]/i.test(months) ? 12 : 1);
      if (years === null) {
        const band = bands.find((b) => clean(row[b.index]));
        if (band) { years = band.age; ageText = d.columns[band.index].header; }
      } else ageText = [ageRaw, months && `${months} months`].filter(Boolean).join(' ');
      if (years !== null) { dateOfBirth = subtractYears(reference, years); dobEstimated = true; }
    }

    const statusRaw = clean(get(row, 'status')).toLowerCase();
    const town = clean(get(row, 'town'));
    const address = [clean(get(row, 'address')), town].filter(Boolean).join(', ');
    const insuranceType = clean(get(row, 'insuranceType'));
    const provider = clean(get(row, 'insuranceProvider'));
    const patient: ImportPatient = {
      ...names,
      dateOfBirth,
      dobEstimated,
      gender,
      phone: normalisePhone(get(row, 'phone')),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(get(row, 'email'))) && !/\.invalid$/i.test(get(row, 'email')) ? clean(get(row, 'email')).toLowerCase() : '',
      address,
      state: clean(get(row, 'state')),
      country: clean(get(row, 'country')) || 'Nigeria',
      occupation: clean(get(row, 'occupation')),
      maritalStatus: clean(get(row, 'maritalStatus')),
      nationalId: clean(get(row, 'nationalId')),
      bloodGroup: normaliseBloodGroup(get(row, 'bloodGroup')) || '',
      genotype: normaliseGenotype(get(row, 'genotype')),
      allergies: normaliseAllergies(get(row, 'allergies')),
      chronicConditions: clean(get(row, 'chronicConditions')).replace(/\s*\((reported|self reported|confirmed)\)/gi, ''),
      currentMedications: clean(get(row, 'currentMedications')),
      emergencyContactName: clean(get(row, 'emergencyContactName')),
      emergencyRelationship: clean(get(row, 'emergencyRelationship')),
      emergencyPhone: normalisePhone(get(row, 'emergencyPhone')),
      emergencyAddress: clean(get(row, 'emergencyAddress')),
      insuranceProvider: /^(self[- ]?pay|cash|private|out of pocket|none)$/i.test(provider) ? '' : provider,
      insurancePolicyNumber: clean(get(row, 'insurancePolicyNumber')),
      insuranceType: insuranceType || (provider && !/^(self[- ]?pay|cash)$/i.test(provider) ? 'HMO' : ''),
      insuranceExpiryDate: parseDate(get(row, 'insuranceExpiryDate'), true) ?? '',
      previousNumber: clean(get(row, 'previousNumber')),
      status: STATUS[statusRaw] ?? 'active',
      department: clean(get(row, 'department')),
      doctorAssigned: clean(get(row, 'doctorAssigned')),
    };
    if (!patient.firstName && !patient.lastName && !patient.previousNumber && !patient.phone) return; // empty or notes line

    const uncertain = new Set<keyof ImportPatient>();
    const cells = uncertainCells?.get(String(i));
    if (cells) {
      const fieldOf = (index: number) => d.columns.find((c) => c.index === index)?.field;
      for (const index of cells) {
        const f = fieldOf(index);
        if (f === 'fullName' || f === 'firstName') uncertain.add('firstName');
        if (f === 'fullName' || f === 'lastName') uncertain.add('lastName');
        if (f === 'age' || f === 'dateOfBirth') uncertain.add('dateOfBirth');
        if (f === 'sex') uncertain.add('gender');
        if (f === 'previousNumber') uncertain.add('previousNumber');
        if (f === 'phone') uncertain.add('phone');
      }
    }

    // A number the scanner wasn't sure of doesn't make two people the same patient.
    const byNumber = patient.previousNumber && !uncertain.has('previousNumber');
    const dupKey = byNumber ? `no:${patient.previousNumber.toLowerCase()}` : `${patient.firstName}|${patient.lastName}|${patient.dateOfBirth}`.toLowerCase();
    const duplicateOf = firstSeen.get(dupKey);
    if (duplicateOf === undefined) firstSeen.set(dupKey, line);
    rows.push({ key: `${line}`, line, include: duplicateOf === undefined, patient, ageText, uncertain: [...uncertain], duplicateOf });
  });
  return rows;
}

// ---------- reading files ----------

/** CSV / TSV / semicolon / pipe text, with quoted fields. */
export function parseDelimited(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, '');
  const firstLines = body.split(/\r?\n/).slice(0, 10).join('\n');
  const counts = [',', ';', '\t', '|'].map((d) => [d, firstLines.split(d).length] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const FHIR_HEADERS = ['Patient ID', 'First Name', 'Middle Name', 'Last Name', 'Date of Birth', 'Sex', 'Phone', 'Email', 'Address', 'City', 'State', 'Country', 'Marital Status', 'Next of Kin', 'Next of Kin Relationship', 'Next of Kin Phone'];

interface FhirPatient {
  resourceType?: string; id?: string; gender?: string; birthDate?: string;
  identifier?: Array<{ value?: string }>;
  name?: Array<{ family?: string; given?: string[]; text?: string; use?: string }>;
  telecom?: Array<{ system?: string; value?: string }>;
  address?: Array<{ line?: string[]; city?: string; state?: string; country?: string; text?: string }>;
  maritalStatus?: { text?: string; coding?: Array<{ display?: string }> };
  contact?: Array<{ name?: { text?: string; family?: string; given?: string[] }; relationship?: Array<{ text?: string; coding?: Array<{ display?: string }> }>; telecom?: Array<{ value?: string }> }>;
}

/** FHIR R4 Patient resources (a Bundle, a list, or NDJSON) → one table. */
function fromFhir(resources: FhirPatient[]): Sheet {
  const rows = resources.filter((r) => r.resourceType === 'Patient').map((p) => {
    const name = p.name?.find((n) => n.use === 'official') ?? p.name?.[0];
    const given = name?.given ?? [];
    const address = p.address?.[0];
    const contact = p.contact?.[0];
    return [
      p.identifier?.[0]?.value ?? p.id ?? '', given[0] ?? (name?.text && !name.family ? name.text : ''), given.slice(1).join(' '), name?.family ?? '',
      p.birthDate ?? '', p.gender ?? '', p.telecom?.find((t) => t.system === 'phone' || t.system === 'sms')?.value ?? '',
      p.telecom?.find((t) => t.system === 'email')?.value ?? '', address?.line?.join(', ') ?? address?.text ?? '', address?.city ?? '',
      address?.state ?? '', address?.country ?? '', p.maritalStatus?.text ?? p.maritalStatus?.coding?.[0]?.display ?? '',
      contact?.name?.text ?? [contact?.name?.given?.join(' '), contact?.name?.family].filter(Boolean).join(' '),
      contact?.relationship?.[0]?.text ?? contact?.relationship?.[0]?.coding?.[0]?.display ?? '', contact?.telecom?.[0]?.value ?? '',
    ];
  });
  return { name: 'FHIR patients', rows: [FHIR_HEADERS, ...rows] };
}

/** HL7 v2 ADT messages: one patient per PID segment. */
function fromHl7(text: string): Sheet {
  const rows: string[][] = [];
  for (const segment of text.split(/\r\n|\r|\n/)) {
    if (!segment.startsWith('PID')) continue;
    const f = segment.split('|');
    const comp = (value: string | undefined, n: number) => (value ?? '').split('~')[0].split('^')[n] ?? '';
    rows.push([
      comp(f[3], 0), comp(f[5], 1), comp(f[5], 2), comp(f[5], 0), (f[7] ?? '').slice(0, 8), f[8] ?? '', comp(f[13], 0) || comp(f[13], 11), comp(f[13], 3),
      [comp(f[11], 0), comp(f[11], 1)].filter(Boolean).join(', '), comp(f[11], 2), comp(f[11], 3), comp(f[11], 5), comp(f[16], 0), '', '', '',
    ]);
  }
  return { name: 'HL7 patients', rows: [FHIR_HEADERS, ...rows] };
}

export async function readImportFile(file: File): Promise<Sheet[]> {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm)$/.test(name)) return readXlsx(await file.arrayBuffer());
  if (/\.(xls|numbers|ods)$/.test(name)) throw new Error('Open this file and save it as .xlsx or .csv first (File → Save As), then import it.');
  const text = await file.text();
  const trimmed = text.trim();
  if (/\.(hl7|txt)$/.test(name) && /^MSH\|/m.test(trimmed)) return [fromHl7(trimmed)];
  if (/\.(json|ndjson)$/.test(name) || /^[[{]/.test(trimmed)) {
    try {
      const lines = name.endsWith('.ndjson') ? trimmed.split(/\n+/).map((l) => JSON.parse(l)) : [JSON.parse(trimmed)];
      const flat = lines.flatMap((d) => (d?.resourceType === 'Bundle' ? (d.entry ?? []).map((e: { resource?: unknown }) => e.resource) : Array.isArray(d) ? d : [d]));
      if (flat.some((r: FhirPatient) => r?.resourceType === 'Patient')) return [fromFhir(flat)];
      // A plain list of records: keys become headings.
      const keys = [...new Set(flat.flatMap((r: Record<string, unknown>) => Object.keys(r ?? {})))];
      return [{ name: 'Records', rows: [keys, ...flat.map((r: Record<string, unknown>) => keys.map((k) => (r?.[k] == null ? '' : String(r[k]))))] }];
    } catch {
      throw new Error('This JSON file couldn’t be read. Export it again as CSV, or as FHIR Patient resources.');
    }
  }
  return [{ name: file.name, rows: parseDelimited(text) }];
}
