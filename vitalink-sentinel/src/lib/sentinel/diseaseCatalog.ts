import type { DiseaseDefinition } from '@/types/sentinel';

/** Central disease ontology — infectious, NTDs, and priority NCDs for surveillance */
export const DISEASE_CATALOG: DiseaseDefinition[] = [
  // Infectious
  { id: 'covid-19', name: 'COVID-19', category: 'infectious', matchTerms: ['covid', 'covid-19', 'sars-cov', 'coronavirus'] },
  { id: 'cholera', name: 'Cholera', category: 'infectious', matchTerms: ['cholera', 'vibrio cholerae'] },
  { id: 'malaria', name: 'Malaria', category: 'infectious', matchTerms: ['malaria', 'plasmodium'] },
  { id: 'tuberculosis', name: 'Tuberculosis', category: 'infectious', matchTerms: ['tuberculosis', 'tb ', ' m.tb', 'pulmonary tb'] },
  { id: 'typhoid', name: 'Typhoid Fever', category: 'infectious', matchTerms: ['typhoid', 'salmonella typhi'] },
  { id: 'lassa', name: 'Lassa Fever', category: 'infectious', matchTerms: ['lassa', 'arenavirus'] },
  { id: 'yellow-fever', name: 'Yellow Fever', category: 'infectious', matchTerms: ['yellow fever', 'flavivirus yellow'] },
  { id: 'measles', name: 'Measles', category: 'infectious', matchTerms: ['measles', 'rubeola'] },
  { id: 'meningitis', name: 'Meningitis', category: 'infectious', matchTerms: ['meningitis', 'meningococcal'] },
  { id: 'mpox', name: 'Mpox', category: 'infectious', matchTerms: ['mpox', 'monkeypox', 'orthopox'] },
  { id: 'ebola', name: 'Ebola', category: 'infectious', matchTerms: ['ebola', 'evd', 'filovirus'] },
  { id: 'hiv', name: 'HIV/AIDS', category: 'infectious', matchTerms: ['hiv', 'aids', 'human immunodeficiency'] },
  { id: 'hepatitis', name: 'Hepatitis', category: 'infectious', matchTerms: ['hepatitis', 'hbv', 'hcv', 'hav'] },
  { id: 'dengue', name: 'Dengue Fever', category: 'infectious', matchTerms: ['dengue'] },
  { id: 'influenza', name: 'Influenza', category: 'infectious', matchTerms: ['influenza', 'flu ', 'flu,'] },
  { id: 'pneumonia', name: 'Pneumonia', category: 'infectious', matchTerms: ['pneumonia', 'cap ', ' bacterial pneumonia'] },

  // NTDs
  { id: 'onchocerciasis', name: 'Onchocerciasis (River Blindness)', category: 'ntd', matchTerms: ['onchocerciasis', 'river blindness'] },
  { id: 'lymphatic-filariasis', name: 'Lymphatic Filariasis', category: 'ntd', matchTerms: ['lymphatic filariasis', 'elephantiasis', 'wuchereria'] },
  { id: 'schistosomiasis', name: 'Schistosomiasis', category: 'ntd', matchTerms: ['schistosomiasis', 'bilharzia'] },
  { id: 'sth', name: 'Soil-transmitted Helminths', category: 'ntd', matchTerms: ['soil-transmitted', 'ascaris', 'hookworm', 'trichuris'] },
  { id: 'trachoma', name: 'Trachoma', category: 'ntd', matchTerms: ['trachoma'] },
  { id: 'leprosy', name: 'Leprosy', category: 'ntd', matchTerms: ['leprosy', 'hansen'] },
  { id: 'buruli-ulcer', name: 'Buruli Ulcer', category: 'ntd', matchTerms: ['buruli'] },
  { id: 'hat', name: 'Human African Trypanosomiasis', category: 'ntd', matchTerms: ['sleeping sickness', 'trypanosomiasis'] },
  { id: 'guinea-worm', name: 'Dracunculiasis (Guinea Worm)', category: 'ntd', matchTerms: ['guinea worm', 'dracunculiasis'] },
  { id: 'chagas', name: 'Chagas Disease', category: 'ntd', matchTerms: ['chagas'] },
  { id: 'vl', name: 'Visceral Leishmaniasis', category: 'ntd', matchTerms: ['leishmaniasis', 'kala-azar'] },
  { id: 'rabies', name: 'Rabies', category: 'ntd', matchTerms: ['rabies'] },
  { id: 'yaws', name: 'Yaws', category: 'ntd', matchTerms: ['yaws'] },

  // NCDs (surveillance indicators)
  { id: 'hypertension', name: 'Hypertension', category: 'ncd', matchTerms: ['hypertension', 'high blood pressure', 'htn'] },
  { id: 'diabetes', name: 'Diabetes', category: 'ncd', matchTerms: ['diabetes', 'dm ', 't2dm', 't1dm'] },
  { id: 'stroke', name: 'Stroke', category: 'ncd', matchTerms: ['stroke', 'cva ', 'cerebrovascular'] },
  { id: 'asthma', name: 'Asthma', category: 'ncd', matchTerms: ['asthma'] },
  { id: 'cancer', name: 'Cancer', category: 'ncd', matchTerms: ['cancer', 'carcinoma', 'malignancy'] },
  { id: 'maternal-mortality', name: 'Maternal mortality indicators', category: 'ncd', matchTerms: ['maternal mortality', 'obstetric hemorrhage'] },
  { id: 'child-mortality', name: 'Child mortality indicators', category: 'ncd', matchTerms: ['infant mortality', 'under-five', 'child mortality'] },
];

export function diseaseById(id: string): DiseaseDefinition | undefined {
  return DISEASE_CATALOG.find((d) => d.id === id);
}
