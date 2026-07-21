import { useState, useEffect } from 'react';
import { MapPin, Users, Building2, Activity, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useSentinelTheme } from '@/hooks/useSentinelTheme';
import type { OutbreakDetails } from '@/types/sentinel';

interface OutbreakDetailModalProps {
  outbreakId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function OutbreakDetailModal({ outbreakId, isOpen, onClose }: OutbreakDetailModalProps) {
  const { classes, isDark } = useSentinelTheme();
  const [details, setDetails] = useState<OutbreakDetails | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (outbreakId && isOpen) {
      loadOutbreakDetails(outbreakId);
    }
  }, [outbreakId, isOpen]);

  const loadOutbreakDetails = async (id: string) => {
    setLoading(true);
    // Import dynamically to avoid circular deps
    const { getOutbreakDetails } = await import('@/lib/sentinel/api/mockApi');
    const data = await getOutbreakDetails(id);
    setDetails(data);
    setLoading(false);
  };

  const statusColors = {
    watch: isDark ? 'text-amber-300 bg-amber-500/20' : 'text-amber-700 bg-amber-100',
    active: isDark ? 'text-red-300 bg-red-500/20' : 'text-red-700 bg-red-100',
    controlled: isDark ? 'text-emerald-300 bg-emerald-500/20' : 'text-emerald-700 bg-emerald-100',
  };

  const severityColors = {
    low: isDark ? 'text-blue-300' : 'text-blue-600',
    moderate: isDark ? 'text-yellow-300' : 'text-yellow-600',
    high: isDark ? 'text-orange-300' : 'text-orange-600',
    critical: isDark ? 'text-red-300' : 'text-red-600',
  };

  if (!details) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className={cn('max-w-4xl max-h-[90vh] overflow-y-auto', classes.bgSurface)}>
          <div className={cn('flex items-center justify-center h-64', classes.textSecondary)}>
            {loading ? 'Loading outbreak details...' : 'No outbreak details available'}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={cn('max-w-4xl max-h-[90vh] overflow-y-auto', classes.bgSurface)}>
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className={cn('text-2xl flex items-center gap-2', classes.textPrimary)}>
                <AlertTriangle className={cn('w-6 h-6', statusColors[details.status].split(' ')[0])} />
                {details.diseaseName} Outbreak
              </DialogTitle>
              <p className={cn('text-sm mt-1', classes.textMuted)}>
                ID: {details.id} • Started {new Date(details.startedAt).toLocaleDateString('en-NG')}
              </p>
            </div>
            <Badge className={cn('px-3 py-1', statusColors[details.status])}>
              {details.status.toUpperCase()}
            </Badge>
          </div>
        </DialogHeader>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList className={cn(classes.bgElevated)}>
            <TabsTrigger value="overview" className={classes.tab}>Overview</TabsTrigger>
            <TabsTrigger value="timeline" className={classes.tab}>Timeline</TabsTrigger>
            <TabsTrigger value="facilities" className={classes.tab}>Facilities</TabsTrigger>
            <TabsTrigger value="team" className={classes.tab}>Team</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className={cn(classes.bgElevated, 'p-3 rounded-lg')}>
                <p className={cn('text-xs', classes.textMuted)}>Total Cases</p>
                <p className={cn('text-2xl font-bold', classes.textPrimary)}>{details.caseCount}</p>
              </div>
              <div className={cn(classes.bgElevated, 'p-3 rounded-lg')}>
                <p className={cn('text-xs', classes.textMuted)}>Facilities</p>
                <p className={cn('text-2xl font-bold', classes.textPrimary)}>{details.facilityCount}</p>
              </div>
              <div className={cn(classes.bgElevated, 'p-3 rounded-lg')}>
                <p className={cn('text-xs', classes.textMuted)}>States</p>
                <p className={cn('text-2xl font-bold', classes.textPrimary)}>{details.affectedStates.length}</p>
              </div>
              <div className={cn(classes.bgElevated, 'p-3 rounded-lg')}>
                <p className={cn('text-xs', classes.textMuted)}>Risk Level</p>
                <p className={cn('text-2xl font-bold', severityColors[details.riskAssessment.severityScore])}>
                  {details.riskAssessment.severityScore.toUpperCase()}
                </p>
              </div>
            </div>

            {/* Risk Assessment */}
            <div className={cn(classes.bgElevated, 'p-4 rounded-lg')}>
              <h4 className={cn('font-semibold mb-2', classes.textPrimary)}>Risk Assessment</h4>
              <div className="space-y-2">
                {details.riskAssessment.factors.map((factor, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <AlertTriangle className={cn('w-4 h-4', severityColors[details.riskAssessment.severityScore])} />
                    <span className={classes.textSecondary}>{factor}</span>
                  </div>
                ))}
              </div>
              <div className={cn('mt-3 text-sm', classes.textMuted)}>
                Confidence: {Math.round(details.riskAssessment.confidenceLevel * 100)}%
              </div>
            </div>

            {/* Recommended Actions */}
            <div className={cn(classes.bgElevated, 'p-4 rounded-lg')}>
              <h4 className={cn('font-semibold mb-3', classes.textPrimary)}>Recommended Actions</h4>
              <div className="space-y-2">
                {details.controlMeasures.map((measure) => (
                  <div key={measure.id} className={cn('flex items-center justify-between p-2 rounded', classes.bgMain)}>
                    <span className={classes.textSecondary}>{measure.measure}</span>
                    <Badge className={cn(
                      measure.status === 'completed' ? classes.badgeGreen :
                      measure.status === 'active' ? classes.badgeBlue :
                      classes.badgeAmber
                    )}>
                      {measure.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="timeline" className="space-y-4 mt-4">
            <div className={cn('space-y-3', classes.bgElevated, 'p-4 rounded-lg')}>
              {details.timeline.map((event, index) => (
                <div key={event.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center',
                      event.type === 'detection' ? 'bg-amber-500' :
                      event.type === 'confirmation' ? 'bg-blue-500' :
                      event.type === 'escalation' ? 'bg-red-500' :
                      event.type === 'control' ? 'bg-emerald-500' :
                      'bg-gray-500'
                    )}>
                      {event.type === 'detection' ? <AlertTriangle className="w-4 h-4 text-white" /> :
                       event.type === 'confirmation' ? <CheckCircle2 className="w-4 h-4 text-white" /> :
                       event.type === 'escalation' ? <Activity className="w-4 h-4 text-white" /> :
                       event.type === 'control' ? <CheckCircle2 className="w-4 h-4 text-white" /> :
                       <Clock className="w-4 h-4 text-white" />}
                    </div>
                    {index < details.timeline.length - 1 && (
                      <div className={cn('w-0.5 flex-1 my-1', classes.bgElevated)} />
                    )}
                  </div>
                  <div className="flex-1 pb-4">
                    <p className={cn('font-medium', classes.textPrimary)}>
                      {event.type.replace('_', ' ').toUpperCase()}
                    </p>
                    <p className={cn('text-sm', classes.textSecondary)}>{event.description}</p>
                    <p className={cn('text-xs mt-1', classes.textMuted)}>
                      {new Date(event.date).toLocaleString('en-NG')} • {event.actor}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="facilities" className="space-y-4 mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {details.affectedFacilities.map((facility) => (
                <div key={facility.facilityId} className={cn(classes.bgElevated, 'p-4 rounded-lg')}>
                  <div className="flex items-start gap-2">
                    <Building2 className={cn('w-5 h-5', classes.textMuted)} />
                    <div className="flex-1">
                      <p className={cn('font-medium', classes.textPrimary)}>{facility.facilityName}</p>
                      <p className={cn('text-sm', classes.textMuted)}>
                        {facility.state} • {facility.lga}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className={cn(classes.bgMain, 'p-2 rounded')}>
                      <p className={cn('text-lg font-bold', classes.textPrimary)}>{facility.caseCount}</p>
                      <p className={cn('text-xs', classes.textMuted)}>Cases</p>
                    </div>
                    <div className={cn(classes.bgMain, 'p-2 rounded')}>
                      <p className={cn('text-xs', classes.textSecondary)}>
                        {new Date(facility.firstCaseDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                      </p>
                      <p className={cn('text-xs', classes.textMuted)}>First</p>
                    </div>
                    <div className={cn(classes.bgMain, 'p-2 rounded')}>
                      <p className={cn('text-xs', classes.textSecondary)}>
                        {new Date(facility.lastCaseDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                      </p>
                      <p className={cn('text-xs', classes.textMuted)}>Last</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="team" className="space-y-4 mt-4">
            {details.investigationTeam ? (
              <div className={cn(classes.bgElevated, 'p-4 rounded-lg space-y-3')}>
                <div className="flex items-center gap-3">
                  <Users className={cn('w-5 h-5', classes.textMuted)} />
                  <div>
                    <p className={cn('font-medium', classes.textPrimary)}>Team Lead</p>
                    <p className={classes.textSecondary}>{details.investigationTeam.lead}</p>
                  </div>
                </div>
                {details.investigationTeam.epidemiologist && (
                  <div className="flex items-center gap-3 pl-8">
                    <Activity className={cn('w-4 h-4', classes.textMuted)} />
                    <p className={classes.textSecondary}>Epidemiologist: {details.investigationTeam.epidemiologist}</p>
                  </div>
                )}
                {details.investigationTeam.labScientist && (
                  <div className="flex items-center gap-3 pl-8">
                    <div className={cn('w-4 h-4 rounded-full', classes.badgeBlue)} />
                    <p className={classes.textSecondary}>Lab Scientist: {details.investigationTeam.labScientist}</p>
                  </div>
                )}
                {details.investigationTeam.contactTracer && (
                  <div className="flex items-center gap-3 pl-8">
                    <MapPin className={cn('w-4 h-4', classes.textMuted)} />
                    <p className={classes.textSecondary}>Contact Tracer: {details.investigationTeam.contactTracer}</p>
                  </div>
                )}
                <p className={cn('text-sm pl-8', classes.textMuted)}>
                  Assigned: {new Date(details.investigationTeam.assignedAt).toLocaleDateString('en-NG')}
                </p>
              </div>
            ) : (
              <p className={cn(classes.textSecondary)}>No investigation team assigned yet.</p>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 mt-4">
          <Button className={classes.buttonGhost} onClick={onClose}>
            Close
          </Button>
          <Button className={classes.buttonPrimary}>
            Download Report
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
