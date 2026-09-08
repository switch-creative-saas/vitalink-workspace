import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Filter, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSentinelTheme } from '@/hooks/useSentinelTheme';
import { DISEASE_CATALOG } from '@/lib/sentinel/diseaseCatalog';
import type { CaseFilters, CaseClassification } from '@/types/sentinel';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (filters: CaseFilters) => void;
  initialFilters?: CaseFilters;
}

const CLASSIFICATIONS: CaseClassification[] = ['suspected', 'probable', 'confirmed', 'recovered', 'fatal'];
const AGE_GROUPS = ['0-4', '5-14', '15-44', '45-64', '65+'];
const GENDERS = ['male', 'female', 'other', 'unknown'] as const;
const SOURCES = ['emr_diagnosis', 'lab_positive', 'pharmacy_signal', 'telemedicine', 'community', 'manual'] as const;

const NIGERIA_STATES = [
  'Lagos', 'Kano', 'Kaduna', 'Rivers', 'Oyo', 'Katsina', 'Borno', 'Bauchi',
  'Niger', 'Jigawa', 'Benue', 'Abia', 'Akwa Ibom', 'Edo', 'Plateau',
  'Enugu', 'Ogun', 'Ondo', 'Sokoto', 'Delta', 'Osun', 'Anambra',
];

export function FilterModal({ isOpen, onClose, onApply, initialFilters }: FilterModalProps) {
  const { classes } = useSentinelTheme();
  
  const [filters, setFilters] = useState<CaseFilters>(initialFilters || {
    diseases: [],
    states: [],
    severity: [],
    ageGroups: [],
    genders: [],
    sources: [],
    dateFrom: '',
    dateTo: '',
    query: '',
  });

  const toggleArrayValue = <T extends string>(key: keyof CaseFilters, value: T) => {
    setFilters(prev => {
      const current = (prev[key] as T[]) || [];
      return {
        ...prev,
        [key]: current.includes(value)
          ? current.filter(v => v !== value)
          : [...current, value],
      };
    });
  };

  const clearFilters = () => {
    setFilters({
      diseases: [],
      states: [],
      severity: [],
      ageGroups: [],
      genders: [],
      sources: [],
      dateFrom: '',
      dateTo: '',
      query: '',
    });
  };

  const hasActiveFilters = Object.values(filters).some(v => 
    Array.isArray(v) ? v.length > 0 : Boolean(v)
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={cn('max-w-3xl max-h-[90vh] overflow-y-auto', classes.bgSurface)}>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className={cn('text-xl flex items-center gap-2', classes.textPrimary)}>
              <Filter className="w-5 h-5" />
              Filter Cases
            </DialogTitle>
            {hasActiveFilters && (
              <Button className={classes.buttonGhost} onClick={clearFilters}>
                <X className="w-4 h-4 mr-1" />
                Clear All
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Search Query */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Search</Label>
            <Input
              value={filters.query || ''}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              placeholder="Search by disease, patient ref, state, facility..."
              className={classes.buttonOutline}
            />
          </div>

          {/* Date Range */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Date Range</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className={cn('text-xs', classes.textMuted)}>From</span>
                <Input
                  type="date"
                  value={filters.dateFrom || ''}
                  onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                  className={classes.buttonOutline}
                />
              </div>
              <div className="space-y-1">
                <span className={cn('text-xs', classes.textMuted)}>To</span>
                <Input
                  type="date"
                  value={filters.dateTo || ''}
                  onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                  className={classes.buttonOutline}
                />
              </div>
            </div>
          </div>

          {/* Diseases */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Diseases</Label>
            <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto p-2 rounded-lg border">
              {DISEASE_CATALOG.slice(0, 20).map((disease) => (
                <button
                  key={disease.id}
                  type="button"
                  onClick={() => toggleArrayValue('diseases', disease.id)}
                  className={cn(
                    'px-2 py-1 text-xs rounded transition-colors',
                    filters.diseases?.includes(disease.id)
                      ? cn(classes.badgeBlue, 'border-transparent')
                      : cn(classes.bgElevated, classes.border, classes.textMuted)
                  )}
                >
                  {disease.name}
                </button>
              ))}
            </div>
          </div>

          {/* States */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>States</Label>
            <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto p-2 rounded-lg border">
              {NIGERIA_STATES.map((state) => (
                <button
                  key={state}
                  type="button"
                  onClick={() => toggleArrayValue('states', state)}
                  className={cn(
                    'px-2 py-1 text-xs rounded transition-colors',
                    filters.states?.includes(state)
                      ? cn(classes.badgeBlue, 'border-transparent')
                      : cn(classes.bgElevated, classes.border, classes.textMuted)
                  )}
                >
                  {state}
                </button>
              ))}
            </div>
          </div>

          {/* Classification */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Classification</Label>
            <div className="flex flex-wrap gap-2">
              {CLASSIFICATIONS.map((classification) => (
                <button
                  key={classification}
                  type="button"
                  onClick={() => toggleArrayValue('severity', classification)}
                  className={cn(
                    'px-3 py-2 text-sm rounded-lg border capitalize transition-colors',
                    filters.severity?.includes(classification)
                      ? cn(
                          classification === 'confirmed' ? classes.badgeGreen :
                          classification === 'suspected' ? classes.badgeAmber :
                          classification === 'fatal' ? classes.badgeRed :
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

          {/* Age Groups */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Age Groups</Label>
            <div className="flex flex-wrap gap-2">
              {AGE_GROUPS.map((age) => (
                <button
                  key={age}
                  type="button"
                  onClick={() => toggleArrayValue('ageGroups', age)}
                  className={cn(
                    'px-3 py-2 text-sm rounded-lg border transition-colors',
                    filters.ageGroups?.includes(age)
                      ? cn(classes.badgeBlue, 'border-transparent')
                      : cn(classes.bgElevated, classes.border)
                  )}
                >
                  {age}
                </button>
              ))}
            </div>
          </div>

          {/* Gender */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Gender</Label>
            <div className="flex flex-wrap gap-2">
              {GENDERS.map((gender) => (
                <button
                  key={gender}
                  type="button"
                  onClick={() => toggleArrayValue('genders', gender)}
                  className={cn(
                    'px-3 py-2 text-sm rounded-lg border capitalize transition-colors',
                    filters.genders?.includes(gender)
                      ? cn(classes.badgeBlue, 'border-transparent')
                      : cn(classes.bgElevated, classes.border)
                  )}
                >
                  {gender}
                </button>
              ))}
            </div>
          </div>

          {/* Source */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Case Source</Label>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => toggleArrayValue('sources', source)}
                  className={cn(
                    'px-3 py-2 text-sm rounded-lg border transition-colors',
                    filters.sources?.includes(source)
                      ? cn(classes.badgeBlue, 'border-transparent')
                      : cn(classes.bgElevated, classes.border)
                  )}
                >
                  {source.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t mt-4">
          <Button className={classes.buttonGhost} onClick={onClose}>
            Cancel
          </Button>
          <Button className={classes.buttonPrimary} onClick={() => onApply(filters)}>
            Apply Filters
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
