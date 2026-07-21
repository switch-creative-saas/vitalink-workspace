import type { ElementType } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Globe2,
  LayoutDashboard,
  LineChart,
  Link2,
  Megaphone,
  Microscope,
  Radar,
  Shield,
  Syringe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSentinel } from '@/contexts/SentinelContext';
import type { SentinelTabId } from '@/types/sentinel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SentinelActivePanel } from '@/components/sentinel/SentinelTabPanels';
import { useSentinelTheme } from '@/hooks/useSentinelTheme';
import { BRAND } from '@/config/brand';

const TAB_META: { id: SentinelTabId; label: string; short: string; icon: ElementType }[] = [
  { id: 'surveillance', label: 'Surveillance', short: 'Dash', icon: LayoutDashboard },
  { id: 'disease-tracking', label: 'Disease tracking', short: 'DX', icon: Activity },
  { id: 'case-reporting', label: 'Case reporting', short: 'Cases', icon: Radar },
  { id: 'outbreak', label: 'Outbreak intelligence', short: 'OB', icon: AlertTriangle },
  { id: 'heatmaps', label: 'Heatmaps', short: 'Map', icon: Globe2 },
  { id: 'contact-tracing', label: 'Contact tracing', short: 'Trace', icon: Link2 },
  { id: 'vaccination', label: 'Vaccination', short: 'Vax', icon: Syringe },
  { id: 'alerts', label: 'Alerts', short: 'Alerts', icon: Bell },
  { id: 'epidemiology-analytics', label: 'Epidemiology AI', short: 'Epi', icon: LineChart },
  { id: 'emergency', label: 'Emergency center', short: 'EOC', icon: Shield },
  { id: 'community', label: 'Community', short: 'CHW', icon: Megaphone },
  { id: 'ntd', label: 'NTD monitoring', short: 'NTD', icon: Microscope },
];

export function VitaLinkSentinelPage() {
  const { activeTab, setActiveTab, allowedTabs, auditTail, tenantId } = useSentinel();
  const { isDark, classes } = useSentinelTheme();

  const visibleTabs = TAB_META.filter((t) => allowedTabs.includes(t.id));

  if (!allowedTabs.length) {
    return (
      <div className={cn(classes.glass, 'p-8 text-center')}>
        <Shield className={cn('w-12 h-12 mx-auto mb-3', isDark ? 'text-amber-300' : 'text-amber-600')} />
        <p className={cn('text-lg font-semibold', classes.textPrimary)}>{BRAND.sentinel}</p>
        <p className={cn('text-sm mt-2 max-w-md mx-auto', classes.textSecondary)}>
          Your role is not provisioned for public health surveillance. Contact your tenant administrator for Public Health / Sentinel access.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6 page-transition', classes.page)}>
      {/* Hero Section */}
      <header className={cn(classes.hero, 'min-w-0 overflow-hidden')}>
        <div className={cn(classes.heroContent, 'flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 min-w-0')}>
          <div className="min-w-0">
            <p className={cn(
              'text-[11px] uppercase tracking-[0.25em] mb-2 truncate',
              isDark ? 'text-amber-300' : 'text-amber-600'
            )}>
              {BRAND.sentinel} · {BRAND.sentinelDescriptor}
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight truncate">
              National-scale surveillance fabric
            </h1>
            <p className="mt-2 text-sm text-white/70 max-w-2xl truncate">
              Real-time EMR · Laboratory · Pharmacy · Telemedicine integrations · hierarchical tenants ({tenantId}) · offline-first community ingest · AI-assisted
              epidemiology (VitaMind AI).
            </p>
          </div>
          <div className="flex flex-wrap gap-2 min-w-0">
            <span className={cn(classes.badgeGreen, 'text-xs min-w-0 truncate')}>
              NDPR anonymized line list
            </span>
            <span className={cn(classes.badgeAmber, 'text-xs min-w-0 truncate')}>
              Audit trail hot
            </span>
            <span className={cn(classes.badgeBlue, 'text-xs min-w-0 truncate')}>
              Future: WHO / NCDC / Africa CDC
            </span>
          </div>
        </div>
      </header>

      {/* Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SentinelTabId)} className="w-full min-w-0">
        <div className="flex flex-wrap gap-2 pb-1 w-full max-w-full min-w-0">
          <TabsList className={cn(
            classes.tabs,
            'inline-flex h-auto min-w-0 flex-nowrap w-full sm:w-auto overflow-hidden'
          )}>
            {visibleTabs.map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm rounded-xl transition-all min-w-0',
                    isActive
                      ? classes.tabActive
                      : cn(classes.tab, 'hover:bg-[var(--sentinel-bg-hover)]')
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="hidden sm:inline whitespace-nowrap truncate">{t.label}</span>
                  <span className="sm:hidden whitespace-nowrap truncate">{t.short}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        <TabsContent value={activeTab} className="mt-6 outline-none animate-in fade-in duration-300 min-w-0">
          <SentinelActivePanel tab={activeTab} />
        </TabsContent>
      </Tabs>

      {/* Audit Trail Footer */}
      <footer className={cn(classes.card, 'p-4 min-w-0 overflow-hidden')}>
        <p className={cn('text-[10px] uppercase tracking-wider mb-2 truncate', classes.textMuted)}>
          Surveillance audit tail (encrypted store)
        </p>
        <div className={cn(
          'text-[11px] font-mono space-y-1 max-h-24 overflow-auto sentinel-scroll',
          classes.textSecondary
        )}>
          {auditTail.slice(0, 6).map((line, i) => (
            <div key={i} className="font-mono truncate">{line}</div>
          ))}
        </div>
      </footer>
    </div>
  );
}
