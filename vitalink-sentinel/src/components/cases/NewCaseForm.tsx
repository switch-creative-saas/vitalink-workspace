import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SButton as Button } from '@/components/standalone/SButton';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { diseaseLibrary, mockActiveOutbreaks, mockFacilities } from '@/data/mockSentinelData';
import { useSentinel } from '@/contexts/SentinelContext';
import type { CaseClassification } from '@/types/sentinel';

export function NewCaseForm({ onDone }: { onDone: () => void }) {
  const { createCase } = useSentinel();
  const [facilityId, setFacilityId] = useState(mockFacilities[0].id);
  const [disease, setDisease] = useState<string>(diseaseLibrary[0].name);
  const [classification, setClassification] = useState<CaseClassification>('suspected');
  const [ageGroup, setAgeGroup] = useState('15-29');
  const [gender, setGender] = useState<'male' | 'female' | 'unknown'>('unknown');
  const [lab, setLab] = useState('yes');
  const [status, setStatus] = useState('active');
  const [linkedOutbreak, setLinkedOutbreak] = useState('none');
  const selectedDisease = useMemo(() => diseaseLibrary.find((item) => item.name === disease) ?? diseaseLibrary[0], [disease]);
  const facility = mockFacilities.find((item) => item.id === facilityId) ?? mockFacilities[0];

  const submit = async () => {
    await createCase({
      diseaseId: disease.toLowerCase().replace(/\s+/g, '-'),
      classification,
      ageGroup,
      gender,
      symptoms: [...selectedDisease.symptoms],
      travelHistory: 'No travel history reported in the last 21 days',
      vaccinationStatus: 'unknown',
      notes: `Standalone direct report. Current status: ${status}. Linked outbreak: ${linkedOutbreak}. Lab conducted: ${lab}.`,
      source: 'manual',
      geo: {
        country: 'Nigeria',
        state: facility.state,
        lga: facility.lga,
        facilityId: facility.id,
        facilityName: facility.name,
      },
    });
    toast.success('Case report submitted', { description: 'Outbreak thresholds were re-evaluated.' });
    onDone();
  };

  return (
    <div className="space-y-5">
      <Section title="Case Identity">
        <Select value={facilityId} onChange={(event) => setFacilityId(event.target.value)}>
          {mockFacilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
        </Select>
        <input className="sentinel-input rounded-xl px-3 py-2 text-sm" placeholder="Reporting officer name" defaultValue="Sentinel Officer" />
        <input className="sentinel-input rounded-xl px-3 py-2 text-sm" type="date" defaultValue="2026-07-20" />
        <input className="sentinel-input rounded-xl px-3 py-2 text-sm" placeholder="Case reference / local ID" />
      </Section>
      <Section title="Disease Information">
        <Select value={disease} onChange={(event) => setDisease(event.target.value)}>
          {diseaseLibrary.map((item) => <option key={item.name} value={item.name}>{item.group} - {item.name}</option>)}
        </Select>
        <Select value={classification} onChange={(event) => setClassification(event.target.value as CaseClassification)}>
          <option value="suspected">Suspected</option>
          <option value="confirmed">Confirmed</option>
          <option value="probable">Probable</option>
        </Select>
        <input className="sentinel-input rounded-xl px-3 py-2 text-sm" type="date" defaultValue="2026-07-18" />
        <Select value={lab} onChange={(event) => setLab(event.target.value)}><option value="yes">Lab test conducted</option><option value="no">No lab test</option></Select>
      </Section>
      <Section title="Patient Demographics">
        <Select value={ageGroup} onChange={(event) => setAgeGroup(event.target.value)}>{['0-5', '6-14', '15-29', '30-49', '50-64', '65+'].map((age) => <option key={age}>{age}</option>)}</Select>
        <Select value={gender} onChange={(event) => setGender(event.target.value as typeof gender)}><option value="male">Male</option><option value="female">Female</option><option value="unknown">Unknown</option></Select>
        <input className="sentinel-input rounded-xl px-3 py-2 text-sm" value={facility.state} readOnly />
        <input className="sentinel-input rounded-xl px-3 py-2 text-sm" value={facility.lga} readOnly />
      </Section>
      <Section title="Clinical Information">
        <div className="col-span-2 flex flex-wrap gap-2">{selectedDisease.symptoms.map((symptom) => <span key={symptom} className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{symptom}</span>)}</div>
        <Select><option>Mild</option><option>Moderate</option><option>Severe</option><option>Critical</option></Select>
        <Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active</option><option value="recovered">Recovered</option><option value="deceased">Deceased</option></Select>
      </Section>
      <Section title="Epidemiological Linkage">
        <Select value={linkedOutbreak} onChange={(event) => setLinkedOutbreak(event.target.value)}>
          <option value="none">Not linked to known outbreak</option>
          {mockActiveOutbreaks.map((outbreak) => <option key={outbreak.id} value={outbreak.id}>{outbreak.disease} - {outbreak.state}</option>)}
        </Select>
        <Select><option>No known contact</option><option>Known contact with confirmed case</option></Select>
        <Select><option>Contact tracing initiated</option><option>Contact tracing pending</option></Select>
      </Section>
      <div className="flex justify-end gap-2">
        <Button className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700" onClick={onDone}>Cancel</Button>
        <Button onClick={submit}>Submit Case Report</Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

