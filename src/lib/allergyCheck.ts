// Flags a drug that matches one of the patient's recorded allergies, including
// common class allergies (e.g. "penicillin" also covers amoxicillin). It is a
// prompt for the pharmacist to check, not a clinical decision: free-text
// allergy records can't be matched exhaustively.

const CLASS_MEMBERS: Record<string, string[]> = {
  penicillin: ['penicillin', 'amoxicillin', 'ampicillin', 'amoxiclav', 'augmentin', 'cloxacillin', 'flucloxacillin', 'dicloxacillin', 'piperacillin', 'benzylpenicillin', 'phenoxymethylpenicillin', 'ampiclox'],
  cephalosporin: ['cef', 'ceph'],
  sulfa: ['sulfamethoxazole', 'co-trimoxazole', 'cotrimoxazole', 'septrin', 'sulfadoxine', 'fansidar', 'sulfasalazine'],
  sulphonamide: ['sulfamethoxazole', 'co-trimoxazole', 'cotrimoxazole', 'septrin', 'sulfadoxine', 'fansidar', 'sulfasalazine'],
  nsaid: ['ibuprofen', 'diclofenac', 'naproxen', 'aspirin', 'piroxicam', 'ketoprofen', 'indomethacin', 'meloxicam', 'celecoxib'],
  aspirin: ['aspirin', 'acetylsalicylic'],
  quinolone: ['ciprofloxacin', 'levofloxacin', 'ofloxacin', 'moxifloxacin', 'norfloxacin'],
  macrolide: ['erythromycin', 'azithromycin', 'clarithromycin'],
  tetracycline: ['tetracycline', 'doxycycline', 'minocycline'],
  codeine: ['codeine', 'co-codamol'],
  opioid: ['morphine', 'codeine', 'tramadol', 'pethidine', 'fentanyl', 'oxycodone'],
  chloroquine: ['chloroquine', 'hydroxychloroquine'],
  artemisinin: ['artemether', 'artesunate', 'lumefantrine', 'coartem', 'dihydroartemisinin'],
};

const IGNORED = new Set(['none', 'nil', 'nkda', 'nka', 'no', 'not recorded', 'none recorded', 'unknown', 'n/a']);

/** The patient's allergy entries the drug may conflict with (empty when none match). */
export function allergyConflicts(allergies: string | null | undefined, drugName: string): string[] {
  const drug = drugName.toLowerCase();
  if (!drug.trim()) return [];
  return (allergies ?? '')
    .split(/[,;\n/]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry && !IGNORED.has(entry.toLowerCase()))
    .filter((entry) => {
      const allergy = entry.toLowerCase().replace(/\s*(allergy|allergic|sensitivity)\s*/g, ' ').trim();
      if (allergy.length < 3) return false;
      if (drug.includes(allergy)) return true;
      const classKey = Object.keys(CLASS_MEMBERS).find((key) => allergy.includes(key));
      return Boolean(classKey && CLASS_MEMBERS[classKey].some((member) => drug.includes(member)));
    });
}
