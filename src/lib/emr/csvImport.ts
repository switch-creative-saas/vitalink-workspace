// Patient exports from EMRs and spreadsheets → the normalised format emr_apply_import takes.
// Columns are recognised by name ("Hospital No", "Surname", "DOB", "Sex", "Allergies"...).

export type CsvField =
  | 'external_id' | 'full_name' | 'first_name' | 'middle_name' | 'last_name' | 'date_of_birth' | 'gender' | 'phone' | 'email'
  | 'address' | 'state' | 'national_id' | 'blood_group' | 'genotype' | 'allergies' | 'conditions' | 'medications';

export const FIELD_LABEL: Record<CsvField, string> = {
  external_id: 'Patient ID in the EMR', full_name: 'Full name', first_name: 'First name', middle_name: 'Middle name', last_name: 'Last name',
  date_of_birth: 'Date of birth', gender: 'Sex', phone: 'Phone', email: 'Email', address: 'Address', state: 'State', national_id: 'NIN',
  blood_group: 'Blood group', genotype: 'Genotype', allergies: 'Allergies', conditions: 'Diagnoses / conditions', medications: 'Current medicines',
};

const PATTERNS: Array<[CsvField, RegExp]> = [
  ['external_id', /^(mrn|hospital ?(no|number|id)|patient ?(id|no|number)|id|record ?(no|number)|folder ?(no|number)|card ?(no|number)|uuid|unique ?id|emr ?id)$/],
  ['first_name', /^(first ?name|given ?name|forename|firstname)$/],
  ['middle_name', /^(middle ?name|other ?names?|othername)$/],
  ['last_name', /^(last ?name|surname|family ?name|lastname)$/],
  ['full_name', /^(name|full ?name|patient ?name|patient)$/],
  ['date_of_birth', /^(dob|d\.o\.b|date ?of ?birth|birth ?date|birthdate)$/],
  ['gender', /^(sex|gender)$/],
  ['phone', /(phone|mobile|tel|gsm|contact ?number)/],
  ['email', /e-?mail/],
  ['national_id', /^(nin|national ?id|national ?identification ?number)$/],
  ['address', /^(address|home ?address|residential ?address)$/],
  ['state', /^(state|state ?of ?residence|region)$/],
  ['blood_group', /^blood/],
  ['genotype', /^genotype$/],
  ['allergies', /allerg/],
  ['conditions', /(diagnos|condition|problem|comorbid)/],
  ['medications', /(medication|medicine|drug|prescription)/],
];

/** Minimal RFC 4180 CSV parser (quoted fields, embedded commas and newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // Excel's byte-order mark
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export function guessMapping(headers: string[]): Array<CsvField | ''> {
  const used = new Set<CsvField>();
  return headers.map((header) => {
    const h = header.trim().toLowerCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' ');
    const match = PATTERNS.find(([field, pattern]) => !used.has(field) && pattern.test(h));
    if (!match) return '';
    used.add(match[0]);
    return match[0];
  });
}

/** Nigerian exports usually write dates day-first (12/03/1985). */
export function toIsoDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? (Number(m[3]) > new Date().getFullYear() % 100 ? `19${m[3]}` : `20${m[3]}`) : m[3];
    const [day, month] = Number(m[1]) > 12 || Number(m[2]) <= 12 ? [m[1], m[2]] : [m[2], m[1]];
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

const list = (value: string) => value.split(/[;|\n]|,(?!\d)/).map((s) => s.trim()).filter(Boolean);

export function rowsToPatients(rows: string[][], mapping: Array<CsvField | ''>): Array<Record<string, unknown>> {
  return rows.map((row, index) => {
    const get = (field: CsvField) => {
      const col = mapping.indexOf(field);
      return col >= 0 ? (row[col] ?? '').trim() : '';
    };
    let first = get('first_name');
    let middle = get('middle_name');
    let last = get('last_name');
    if ((!first || !last) && get('full_name')) {
      // "SURNAME, Firstname" or "Firstname Middle Surname"
      const full = get('full_name');
      const parts = full.includes(',') ? [full.split(',')[1].trim(), full.split(',')[0].trim()].join(' ').split(/\s+/) : full.split(/\s+/);
      first ||= parts[0] ?? '';
      last ||= parts.length > 1 ? parts[parts.length - 1] : '';
      middle ||= parts.slice(1, -1).join(' ');
    }
    const dob = toIsoDate(get('date_of_birth'));
    const externalId = get('external_id') || `${first}|${last}|${dob ?? ''}|${index}`.toLowerCase();
    return {
      external_id: externalId,
      first_name: first, middle_name: middle || undefined, last_name: last, date_of_birth: dob, gender: get('gender'),
      phone: get('phone'), email: get('email') || undefined, address: get('address') || undefined, state: get('state') || undefined,
      national_id: get('national_id') || undefined, blood_group: get('blood_group') || undefined, genotype: get('genotype') || undefined,
      allergies: list(get('allergies')).map((substance) => ({ substance })),
      conditions: list(get('conditions')).map((name) => ({ name, status: 'active' })),
      medications: list(get('medications')).map((name) => ({ name, status: 'active' })),
    };
  });
}
