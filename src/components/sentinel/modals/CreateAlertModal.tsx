import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Bell, Mail, MessageSquare, Megaphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSentinelTheme } from '@/hooks/useSentinelTheme';
import { DISEASE_CATALOG } from '@/lib/sentinel/diseaseCatalog';
import type { NewAlertData, PublicAlertType, AlertPriority } from '@/types/sentinel';
import { toast } from 'sonner';

interface CreateAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: NewAlertData) => Promise<void>;
}

const ALERT_TYPES: { value: PublicAlertType; label: string; icon: React.ReactNode }[] = [
  { value: 'outbreak_warning', label: 'Outbreak Warning', icon: <AlertTriangle className="w-4 h-4" /> },
  { value: 'mortality_spike', label: 'Mortality Spike', icon: <AlertTriangle className="w-4 h-4" /> },
  { value: 'medicine_shortage', label: 'Medicine Shortage', icon: <Bell className="w-4 h-4" /> },
  { value: 'vaccine_shortage', label: 'Vaccine Shortage', icon: <Bell className="w-4 h-4" /> },
  { value: 'icu_overload', label: 'ICU Overload', icon: <AlertTriangle className="w-4 h-4" /> },
  { value: 'disease_cluster', label: 'Disease Cluster', icon: <Megaphone className="w-4 h-4" /> },
];

const PRIORITIES: { value: AlertPriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-blue-500' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500' },
  { value: 'high', label: 'High', color: 'bg-orange-500' },
  { value: 'emergency', label: 'Emergency', color: 'bg-red-500' },
];

const NIGERIA_STATES = [
  'Lagos', 'Kano', 'Kaduna', 'Rivers', 'Oyo', 'Katsina', 'Borno', 'Bauchi',
  'Niger', 'Jigawa', 'Benue', 'Abia', 'Akwa Ibom', 'Edo', 'Plateau',
  'Enugu', 'Ogun', 'Ondo', 'Sokoto', 'Delta', 'Osun', 'Anambra',
];

export function CreateAlertModal({ isOpen, onClose, onCreate }: CreateAlertModalProps) {
  const { classes, isDark } = useSentinelTheme();
  const [loading, setLoading] = useState(false);
  
  const [formData, setFormData] = useState<NewAlertData>({
    type: 'outbreak_warning',
    priority: 'high',
    title: '',
    body: '',
    diseaseId: undefined,
    region: undefined,
    targetStates: [],
    channels: ['inApp'],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.body.trim()) {
      toast.error('Title and body are required');
      return;
    }
    
    setLoading(true);
    try {
      await onCreate(formData);
      toast.success('Alert created and broadcast initiated');
      onClose();
      // Reset form
      setFormData({
        type: 'outbreak_warning',
        priority: 'high',
        title: '',
        body: '',
        diseaseId: undefined,
        region: undefined,
        targetStates: [],
        channels: ['inApp'],
      });
    } catch (error) {
      toast.error('Failed to create alert');
    } finally {
      setLoading(false);
    }
  };

  const toggleChannel = (channel: 'inApp' | 'email' | 'sms') => {
    setFormData(prev => ({
      ...prev,
      channels: prev.channels.includes(channel)
        ? prev.channels.filter(c => c !== channel)
        : [...prev.channels, channel],
    }));
  };

  const toggleState = (state: string) => {
    setFormData(prev => ({
      ...prev,
      targetStates: prev.targetStates?.includes(state)
        ? prev.targetStates.filter(s => s !== state)
        : [...(prev.targetStates || []), state],
    }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={cn('max-w-2xl max-h-[90vh] overflow-y-auto', classes.bgSurface)}>
        <DialogHeader>
          <DialogTitle className={cn('text-xl flex items-center gap-2', classes.textPrimary)}>
            <Megaphone className={cn('w-5 h-5', isDark ? 'text-amber-300' : 'text-amber-600')} />
            Create Public Health Alert
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Alert Type */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Alert Type</Label>
            <Select
              value={formData.type}
              onValueChange={(v) => setFormData({ ...formData, type: v as PublicAlertType })}
            >
              <SelectTrigger className={classes.buttonOutline}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALERT_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    <div className="flex items-center gap-2">
                      {type.icon}
                      {type.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Priority */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Priority</Label>
            <div className="flex gap-2 flex-wrap">
              {PRIORITIES.map((priority) => (
                <button
                  key={priority.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, priority: priority.value })}
                  className={cn(
                    'px-3 py-2 rounded-lg border transition-all',
                    formData.priority === priority.value
                      ? cn(classes.borderStrong, priority.color.replace('bg-', 'border-'), 'ring-2', priority.color.replace('bg-', 'ring-'))
                      : classes.border,
                    classes.bgElevated
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className={cn('w-2 h-2 rounded-full', priority.color)} />
                    <span className={cn('text-sm', classes.textPrimary)}>{priority.label}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Alert Title</Label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g., Cholera Outbreak Alert: Lagos State"
              className={classes.buttonOutline}
              required
            />
          </div>

          {/* Body */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Alert Body</Label>
            <Textarea
              value={formData.body}
              onChange={(e) => setFormData({ ...formData, body: e.target.value })}
              placeholder="Detailed description of the alert..."
              className={cn(classes.buttonOutline, 'min-h-[100px]')}
              required
            />
          </div>

          {/* Disease Link (optional) */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Related Disease (Optional)</Label>
            <Select
              value={formData.diseaseId || 'none'}
              onValueChange={(v) => setFormData({ ...formData, diseaseId: v === 'none' ? undefined : v })}
            >
              <SelectTrigger className={classes.buttonOutline}>
                <SelectValue placeholder="Select disease..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {DISEASE_CATALOG.map((disease) => (
                  <SelectItem key={disease.id} value={disease.id}>
                    {disease.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Target States */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Target States</Label>
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-2 rounded-lg border">
              {NIGERIA_STATES.map((state) => (
                <button
                  key={state}
                  type="button"
                  onClick={() => toggleState(state)}
                  className={cn(
                    'px-2 py-1 text-xs rounded transition-colors',
                    formData.targetStates?.includes(state)
                      ? cn(classes.badgeBlue, 'border-transparent')
                      : cn(classes.bgElevated, classes.border, classes.textMuted)
                  )}
                >
                  {state}
                </button>
              ))}
            </div>
          </div>

          {/* Delivery Channels */}
          <div className="space-y-2">
            <Label className={classes.textSecondary}>Delivery Channels</Label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => toggleChannel('inApp')}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border transition-all',
                  formData.channels.includes('inApp')
                    ? cn(classes.badgeBlue, 'border-transparent')
                    : cn(classes.bgElevated, classes.border)
                )}
              >
                <MessageSquare className="w-4 h-4" />
                <span className="text-sm">In-App</span>
              </button>
              <button
                type="button"
                onClick={() => toggleChannel('email')}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border transition-all',
                  formData.channels.includes('email')
                    ? cn(classes.badgeBlue, 'border-transparent')
                    : cn(classes.bgElevated, classes.border)
                )}
              >
                <Mail className="w-4 h-4" />
                <span className="text-sm">Email</span>
              </button>
              <button
                type="button"
                onClick={() => toggleChannel('sms')}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border transition-all',
                  formData.channels.includes('sms')
                    ? cn(classes.badgeBlue, 'border-transparent')
                    : cn(classes.bgElevated, classes.border)
                )}
              >
                <MessageSquare className="w-4 h-4" />
                <span className="text-sm">SMS</span>
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" className={classes.buttonGhost} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className={classes.buttonPrimary} disabled={loading}>
              {loading ? 'Creating...' : 'Create Alert'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
