// FHIR R4 → the normalised payload emr_apply_import takes. Used by emr-sync (pulling
// from OpenMRS/NMRS, Bahmni, OpenEMR or any FHIR server) and emr-ingest (records
// pushed to VitaLink by a commercial EMR).

// deno-lint-ignore no-explicit-any
export type Resource = Record<string, any>;
export type Row = Record<string, unknown>;

export interface NormalisedPatient extends Row {
  external_id: string;
  allergies: Row[];
  conditions: Row[];
  medications: Row[];
  vitals: Row[];
  labs: Row[];
  encounters: Row[];
  notes: Row[];
  immunizations: Row[];
  procedures: Row[];
  observations: Row[];
}

/** Vital signs by LOINC code, plus the CIEL concepts OpenMRS-based EMRs (NMRS, Bahmni) use. */
const VITAL_CODES: Record<string, keyof typeof VITAL_LIMITS> = {
  '8310-5': 'temperature_c', '8331-1': 'temperature_c', '5088': 'temperature_c',
  '8867-4': 'heart_rate', '5087': 'heart_rate',
  '8480-6': 'systolic', '5085': 'systolic',
  '8462-4': 'diastolic', '5086': 'diastolic',
  '9279-1': 'respiratory_rate', '5242': 'respiratory_rate',
  '59408-5': 'spo2', '2708-6': 'spo2', '5092': 'spo2',
  '29463-7': 'weight_kg', '3141-9': 'weight_kg', '5089': 'weight_kg',
  '8302-2': 'height_cm', '8306-3': 'height_cm', '5090': 'height_cm',
};
const VITAL_LIMITS = { temperature_c: 1, heart_rate: 1, systolic: 1, diastolic: 1, respiratory_rate: 1, spo2: 1, weight_kg: 1, height_cm: 1 };
const BP_PANEL = new Set(['85354-9', '55284-4', '35094-2']);

const codes = (concept?: Resource): string[] => (concept?.coding ?? []).map((c: Resource) => String(c.code ?? '')).filter(Boolean);
export const textOf = (concept?: Resource): string =>
  concept?.text || concept?.coding?.find((c: Resource) => c.display)?.display || concept?.coding?.[0]?.code || '';
const ref = (reference?: Resource): string | null => {
  const r: string | undefined = reference?.reference;
  if (!r) return null;
  const parts = r.split('/');
  return parts.length >= 2 ? parts[parts.length - 1] : r;
};
const display = (reference?: Resource): string => reference?.display ?? '';
const statusOf = (concept?: Resource): string | undefined => concept?.coding?.[0]?.code ?? concept?.text;
/** A code worth showing: ICD-10 first, then any short code (OpenMRS concept UUIDs mean nothing to clinicians). */
const clinicalCode = (concept?: Resource): string | undefined => {
  const coding: Resource[] = concept?.coding ?? [];
  const icd = coding.find((c) => /icd-?10/i.test(c.system ?? ''))?.code;
  if (icd) return icd;
  return coding.map((c) => String(c.code ?? '')).find((c) => c && c.length <= 12 && !/A{8,}$/.test(c));
};

/** The patient a clinical resource belongs to. */
export function subjectOf(resource: Resource): string | null {
  return ref(resource.subject) ?? ref(resource.patient) ?? ref(resource.beneficiary);
}

export function emptyPatient(externalId: string): NormalisedPatient {
  return { external_id: externalId, allergies: [], conditions: [], medications: [], vitals: [], labs: [], encounters: [], notes: [], immunizations: [], procedures: [], observations: [] };
}

export function fromFhirPatient(p: Resource): NormalisedPatient {
  const name = (p.name ?? []).find((n: Resource) => n.use === 'official') ?? p.name?.[0] ?? {};
  const given: string[] = name.given ?? [];
  const phone = (p.telecom ?? []).find((t: Resource) => t.system === 'phone' && t.value)?.value;
  const email = (p.telecom ?? []).find((t: Resource) => t.system === 'email' && t.value)?.value;
  const address = (p.address ?? []).find((a: Resource) => a.use === 'home') ?? p.address?.[0];
  const nin = (p.identifier ?? []).find((i: Resource) =>
    /nin|national/i.test(`${i.system ?? ''} ${textOf(i.type)}`))?.value;
  return {
    ...emptyPatient(String(p.id)),
    first_name: given[0] ?? (name.text ? String(name.text).split(' ')[0] : ''),
    middle_name: given.slice(1).join(' ') || undefined,
    last_name: name.family ?? (name.text ? String(name.text).split(' ').slice(1).join(' ') : ''),
    date_of_birth: p.birthDate,
    gender: p.gender,
    phone,
    email,
    address: address ? [...(address.line ?? []), address.city, address.district].filter(Boolean).join(', ') : undefined,
    state: address?.state,
    national_id: nin,
  };
}

function quantity(o: Resource): { value: number | null; unit: string } {
  const q = o.valueQuantity;
  if (!q || typeof q.value !== 'number') return { value: null, unit: '' };
  return { value: q.value, unit: q.unit ?? q.code ?? '' };
}

/** Converts imperial units the vitals table doesn't store. */
function metric(field: string, value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (field === 'weight_kg' && /lb/.test(u)) return Math.round(value * 0.4536 * 10) / 10;
  if (field === 'height_cm' && /\[in|inch/.test(u)) return Math.round(value * 2.54 * 10) / 10;
  if (field === 'height_cm' && u === 'm') return value * 100;
  return value;
}

function observationValue(o: Resource): { value: string; unit: string } {
  if (o.valueQuantity) return { value: String(o.valueQuantity.value ?? ''), unit: o.valueQuantity.unit ?? o.valueQuantity.code ?? '' };
  if (o.valueCodeableConcept) return { value: textOf(o.valueCodeableConcept), unit: '' };
  if (o.valueString !== undefined) return { value: String(o.valueString), unit: '' };
  if (o.valueBoolean !== undefined) return { value: o.valueBoolean ? 'Yes' : 'No', unit: '' };
  if (o.valueInteger !== undefined) return { value: String(o.valueInteger), unit: '' };
  return { value: '', unit: '' };
}

function referenceRange(o: Resource): string {
  const r = o.referenceRange?.[0];
  if (!r) return '';
  if (r.text) return r.text;
  const low = r.low?.value;
  const high = r.high?.value;
  return low !== undefined && high !== undefined ? `${low}-${high}` : low !== undefined ? `>${low}` : high !== undefined ? `<${high}` : '';
}

const isCategory = (o: Resource, category: string) =>
  (o.category ?? []).some((c: Resource) => codes(c).includes(category) || new RegExp(category, 'i').test(textOf(c)));

/** Adds one clinical resource to its patient's record. Returns false for types VitaLink doesn't keep. */
export function addResource(patient: NormalisedPatient, r: Resource, vitalsByMoment: Map<string, Row>): boolean {
  const id = r.id ? `${r.resourceType}/${r.id}` : undefined;
  switch (r.resourceType) {
    case 'Observation': {
      if (r.status === 'entered-in-error' || r.status === 'cancelled') return true;
      const when = r.effectiveDateTime ?? r.effectivePeriod?.start ?? r.issued;
      const observationCodes = codes(r.code);
      const vitalFields: Array<[string, number]> = [];
      if (observationCodes.some((c) => BP_PANEL.has(c))) {
        for (const component of r.component ?? []) {
          const field = codes(component.code).map((c) => VITAL_CODES[c]).find(Boolean);
          const { value, unit } = quantity(component);
          if (field && value !== null) vitalFields.push([field, metric(field, value, unit)]);
        }
      } else {
        const field = observationCodes.map((c) => VITAL_CODES[c]).find(Boolean);
        const { value, unit } = quantity(r);
        if (field && value !== null) vitalFields.push([field, metric(field, value, unit)]);
      }
      if (vitalFields.length) {
        // Readings taken together (same visit and time) become one vitals entry.
        const key = `${ref(r.encounter) ?? ''}|${when ?? ''}`;
        const row = vitalsByMoment.get(key) ?? { external_id: `vitals:${key}`, recorded_at: when };
        for (const [field, value] of vitalFields) row[field] = value;
        if (!vitalsByMoment.has(key)) { vitalsByMoment.set(key, row); patient.vitals.push(row); }
        return true;
      }
      const { value, unit } = observationValue(r);
      if (isCategory(r, 'laboratory')) {
        patient.labs.push({
          external_id: id, test_name: textOf(r.code), value, unit, reference_range: referenceRange(r),
          flag: r.interpretation?.[0]?.coding?.[0]?.code ?? textOf(r.interpretation?.[0]),
          interpretation: r.note?.map((n: Resource) => n.text).join(' ') || undefined, resulted_at: r.issued ?? when,
        });
      } else if (textOf(r.code)) {
        patient.observations.push({ external_id: id, name: textOf(r.code), value, unit, status: r.status, recorded_at: when });
      }
      return true;
    }
    case 'Condition':
      patient.conditions.push({
        external_id: id, name: textOf(r.code), status: statusOf(r.clinicalStatus),
        code: clinicalCode(r.code),
        onset: r.onsetDateTime ?? r.onsetPeriod?.start, recorded_at: r.recordedDate,
      });
      return true;
    case 'AllergyIntolerance':
      patient.allergies.push({
        external_id: id, substance: textOf(r.code), status: statusOf(r.clinicalStatus),
        reaction: r.reaction?.[0]?.manifestation?.map((m: Resource) => textOf(m)).filter(Boolean).join(', ') || undefined,
        severity: r.reaction?.[0]?.severity ?? r.criticality, recorded_at: r.recordedDate,
      });
      return true;
    case 'MedicationRequest':
    case 'MedicationStatement':
      patient.medications.push({
        external_id: id, name: textOf(r.medicationCodeableConcept) || display(r.medicationReference),
        dosage: r.dosageInstruction?.[0]?.text ?? r.dosage?.[0]?.text, status: r.status,
        recorded_at: r.authoredOn ?? r.effectiveDateTime ?? r.dateAsserted,
      });
      return true;
    case 'Encounter':
      patient.encounters.push({
        external_id: id, type: textOf(r.type?.[0]) || r.class?.display || r.class?.code, reason: textOf(r.reasonCode?.[0]) || undefined,
        started_at: r.period?.start, ended_at: r.period?.end, status: r.status,
        location: display(r.location?.[0]?.location) || undefined, provider: display(r.participant?.[0]?.individual) || undefined,
      });
      return true;
    case 'Immunization':
      patient.immunizations.push({
        external_id: id, vaccine: textOf(r.vaccineCode), date: r.occurrenceDateTime ?? r.occurrenceString, status: r.status,
        dose: r.protocolApplied?.[0]?.doseNumberPositiveInt ?? r.protocolApplied?.[0]?.doseNumberString,
      });
      return true;
    case 'Procedure':
      patient.procedures.push({ external_id: id, name: textOf(r.code), date: r.performedDateTime ?? r.performedPeriod?.start, status: r.status });
      return true;
    case 'DocumentReference': {
      const attachment = r.content?.[0]?.attachment ?? {};
      let text = '';
      if (attachment.data && /^text\//.test(attachment.contentType ?? 'text/plain')) {
        try { text = new TextDecoder().decode(Uint8Array.from(atob(attachment.data), (ch) => ch.charCodeAt(0))); } catch { /* not text */ }
      }
      patient.notes.push({
        external_id: id, title: r.description || textOf(r.type) || attachment.title || 'Document',
        text: text.slice(0, 20000) || (attachment.url ? `Stored in the source EMR: ${attachment.url}` : undefined),
        recorded_at: r.date ?? attachment.creation, author: display(r.author?.[0]) || undefined,
      });
      return true;
    }
    case 'DiagnosticReport':
      if (r.conclusion) patient.notes.push({ external_id: id, title: textOf(r.code) || 'Report', text: r.conclusion, recorded_at: r.effectiveDateTime ?? r.issued });
      return true;
    default:
      return false;
  }
}

/** A Bundle (or a single resource, or a list of resources) → normalised patients. */
export function fromFhirResources(resources: Resource[]): { patients: NormalisedPatient[]; skipped: number } {
  const patients = new Map<string, NormalisedPatient>();
  const vitals = new Map<string, Map<string, Row>>();
  let skipped = 0;
  const patientFor = (id: string) => {
    let p = patients.get(id);
    if (!p) { p = emptyPatient(id); patients.set(id, p); vitals.set(id, new Map()); }
    return p;
  };
  for (const r of resources.filter((x) => x?.resourceType === 'Patient')) {
    const normalised = fromFhirPatient(r);
    const existing = patients.get(normalised.external_id);
    patients.set(normalised.external_id, existing ? { ...existing, ...normalised, ...pickLists(existing) } : normalised);
    if (!vitals.has(normalised.external_id)) vitals.set(normalised.external_id, new Map());
  }
  for (const r of resources.filter((x) => x?.resourceType && x.resourceType !== 'Patient')) {
    const subject = subjectOf(r);
    if (!subject) { skipped += 1; continue; }
    if (!addResource(patientFor(subject), r, vitals.get(subject)!)) skipped += 1;
  }
  return { patients: [...patients.values()], skipped };
}

function pickLists(p: NormalisedPatient) {
  const { allergies, conditions, medications, vitals, labs, encounters, notes, immunizations, procedures, observations } = p;
  return { allergies, conditions, medications, vitals, labs, encounters, notes, immunizations, procedures, observations };
}

export function resourcesOf(body: Resource): Resource[] {
  if (Array.isArray(body)) return body;
  if (body?.resourceType === 'Bundle') return (body.entry ?? []).map((e: Resource) => e.resource).filter(Boolean);
  if (body?.resourceType) return [body];
  return [];
}
