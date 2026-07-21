import { DISEASE_CATALOG } from '@/lib/sentinel/diseaseCatalog';
import type { DiseaseDefinition } from '@/types/sentinel';

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Match EMR diagnosis text or lab analyte string to catalog entries (best effort). */
export function matchDiseasesFromText(text: string): DiseaseDefinition[] {
  const n = normalize(text);
  if (!n) return [];
  const hits: DiseaseDefinition[] = [];
  for (const d of DISEASE_CATALOG) {
    if (d.matchTerms.some((t) => n.includes(t))) hits.push(d);
  }
  return hits;
}

export function primaryMatch(text: string): DiseaseDefinition | undefined {
  const hits = matchDiseasesFromText(text);
  return hits[0];
}
