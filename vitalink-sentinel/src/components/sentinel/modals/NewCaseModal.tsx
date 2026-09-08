import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSentinelTheme } from '@/hooks/useSentinelTheme';
import { DISEASE_CATALOG } from '@/lib/sentinel/diseaseCatalog';
import type { NewCaseData, CaseClassification } from '@/types/sentinel';
import { toast } from 'sonner';

interface NewCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: NewCaseData) => Promise<void>;
}

const CLASSIFICATIONS: CaseClassification[] = ['suspected', 'probable', 'confirmed'];
const AGE_GROUPS = ['0-4', '5-14', '15-44', '45-64', '65+'];
const SOURCES = ['emr_diagnosis', 'lab_positive', 'pharmacy_signal', 'telemedicine', 'community', 'manual'] as const;
const GENDERS = ['male', 'female', 'other', 'unknown'] as const;

const NIGERIA_STATES = [
  'Lagos', 'Kano', 'Kaduna', 'Rivers', 'Oyo', 'Katsina', 'Borno', 'Bauchi',
  'Niger', 'Jigawa', 'Benue', 'Abia', 'Akwa Ibom', 'Edo', 'Plateau',
  'Enugu', 'Ogun', 'Ondo', 'Sokoto', 'Delta', 'Osun', 'Anambra',
];

export function NewCaseModal({ isOpen, onClose, onCreate }: NewCaseModalProps) {
  const { classes } = useSentinelTheme();
  const [loading, setLoading] = useState(false);
  
  const [formData, setFormData] = useState<Partial<NewCaseData>>({
    diseaseId: '',
    classification: 'suspected',
    ageGroup: '15-44',
    gender: 'unknown',
    source: 'manual',
    symptoms: [],
    vaccinationStatus: 'unknown',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.diseaseId || !formData.geo) {
      toast.error('Disease and location are required');
      return;
    }
    
    setLoading(true);
    try {
      await onCreate(formData as NewCaseData);
      toast.success('Case reported successfully');
      onClose();
      // Reset form
      setFormData({
        diseaseId: '',
        classification: 'suspected',
        ageGroup: '15-44',
        gender: 'unknown',
        source: 'manual',
        symptoms: [],
        vaccinationStatus: 'unknown',
      });
    } catch (error) {
      toast.error('Failed to report case');
    } finally {
      setLoading(false);
    }
  };

  const toggleSymptom = (symptom: string) => {
    setFormData(prev => ({
      ...prev,
      symptoms: prev.symptoms?.includes(symptom)
        ? prev.symptoms.filter(s => s !== symptom)
        : [...(prev.symptoms || []), symptom],
    }));
  };

  const COMMON_SYMPTOMS = [
    'Fever', 'Cough', 'Shortness of breath', 'Fatigue', 'Headache',
    'Body aches', 'Nausea', 'Vomiting', 'Diarrhea', 'Rash',
    'Joint pain', 'Abdominal pain', 'Chest pain', 'Confusion', 'Seizures',
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={cn('max-w-2xl max-h-[90vh] overflow-y-auto', classes.bgSurface)}>
        <DialogHeader>
          <DialogTitle className={cn('text-xl flex items-center gap-2', classes.textPrimary)}>
            <Plus className="w-5 h-5" />
            Report New Case
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Disease Selection */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Disease *</Label>
            <Select
              value={formData.diseaseId || 'none'}
              onValueChange={(v) => setFormData({ ...formData, diseaseId: v === 'none' ? '' : v })}
            >
              <SelectTrigger className={classes.buttonOutline}>
                <SelectValue placeholder="Select disease..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select disease...</SelectItem>
                {DISEASE_CATALOG.map((disease) => (
                  <SelectItem key={disease.id} value={disease.id}>
                    {disease.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Classification */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Classification</Label>
            <div className="flex flex-wrap gap-2">
              {CLASSIFICATIONS.map((classification) => (
                <button
                  key={classification}
                  type="button"
                  onClick={() => setFormData({ ...formData, classification })}
                  className={cn(
                    'px-3 py-2 text-sm rounded-lg border capitalize transition-colors',
                    formData.classification === classification
                      ? cn(
                          classification === 'confirmed' ? classes.badgeGreen :
                          classification === 'suspected' ? classes.badgeAmber :
                          classes.badgeBlue,
                          'border-transparent'
                        )
                      : cn(classes.bgElevated, classes.border)
                  )}
                >
                  {classification}
                </button>
              ))}
            </div>
          </div>

          {/* Patient Information */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className={classes.textSecondary}>Age Group</Label>
              <Select
                value={formData.ageGroup}
                onValueChange={(v) => setFormData({ ...formData, ageGroup: v })}
              >
                <SelectTrigger className={classes.buttonOutline}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGE_GROUPS.map((age) => (
                    <SelectItem key={age} value={age}>{age}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className={classes.textSecondary}>Gender</Label>
              <Select
                value={formData.gender}
                onValueChange={(v) => setFormData({ ...formData, gender: v as typeof GENDERS[number] })}
              >
                <SelectTrigger className={classes.buttonOutline}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GENDERS.map((gender) => (
                    <SelectItem key={gender} value={gender} className="capitalize">{gender}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Symptoms */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Symptoms</Label>
            <div className="flex flex-wrap gap-2">
              {COMMON_SYMPTOMS.map((symptom) => (
                <button
                  key={symptom}
                  type="button"
                  onClick={() => toggleSymptom(symptom)}
                  className={cn(
                    'px-2 py-1 text-xs rounded border transition-colors',
                    formData.symptoms?.includes(symptom)
                      ? cn(classes.badgeBlue, 'border-transparent')
                      : cn(classes.bgElevated, classes.border, classes.textMuted)
                  )}
                >
                  {symptom}
                </button>
              ))}
            </div>
          </div>

          {/* Location */}
          <div className="space-y-3 p-3 rounded-lg border">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MapPin className="w-4 h-4" />
              <span className={classes.textPrimary}>Location *</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className={cn('text-xs', classes.textMuted)}>State</span>
                <Select
                  value={formData.geo?.state || ''}
                  onValueChange={(v) => setFormData({
                    ...formData,
                    geo: { ...formData.geo!, state: v, lga: '', facilityId: '', facilityName: '', coordinates: { lat: 0, lng: 0 } }
                  })}
                >
                  <SelectTrigger className={classes.buttonOutline}>
                    <SelectValue placeholder="Select state..." />
                  </SelectTrigger>
                  <SelectContent>
                    {NIGERIA_STATES.map((state) => (
                      <SelectItem key={state} value={state}>{state}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <span className={cn('text-xs', classes.textMuted)}>LGA</span>
                <Input
                  value={formData.geo?.lga || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    geo: { ...formData.geo!, lga: e.target.value }
                  })}
                  placeholder="Enter LGA..."
                  className={classes.buttonOutline}
                />
              </div>
            </div>
            <div className="space-y-1">
              <span className={cn('text-xs', classes.textMuted)}>Facility Name</span>
              <Input
                value={formData.geo?.facilityName || ''}
                onChange={(e) => setFormData({
                  ...formData,
                  geo: { ...formData.geo!, facilityName: e.target.value, facilityId: `fac-${Date.now()}` }
                })}
                placeholder="Reporting facility..."
                className={classes.buttonOutline}
              />
            </div>
          </div>

          {/* Source */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Case Source</Label>
            <Select
              value={formData.source}
              onValueChange={(v) => setFormData({ ...formData, source: v as typeof SOURCES[number] })}
            >
              <SelectTrigger className={classes.buttonOutline}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCES.map((source) => (
                  <SelectItem key={source} value={source}>
                    {source.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Vaccination Status */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Vaccination Status</Label>
            <Select
              value={formData.vaccinationStatus}
              onValueChange={(v) => setFormData({ ...formData, vaccinationStatus: v as 'vaccinated' | 'partial' | 'unvaccinated' | 'unknown' })}
            >
              <SelectTrigger className={classes.buttonOutline}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">Unknown</SelectItem>
                <SelectItem value="unvaccinated">Unvaccinated</SelectItem>
                <SelectItem value="partial">Partially Vaccinated</SelectItem>
                <SelectItem value="vaccinated">Fully Vaccinated</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Additional Notes</Label>
            <Textarea
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Additional clinical notes, travel history, or relevant details..."
              className={cn(classes.buttonOutline, 'min-h-[80px]')}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" className={classes.buttonGhost} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className={classes.buttonPrimary} disabled={loading}>
              {loading ? 'Submitting...' : 'Report Case'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
