// Sidebar component — Sentinel submenu uses Public Health RBAC
import { Fragment, useState, type ElementType } from 'react';
import {
  LayoutDashboard,
  CreditCard,
  Users,
  FileText,
  CalendarDays,
  FlaskConical,
  Pill,
  BarChart3,
  Settings,
  HelpCircle,
  Lock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Sparkles,
  UserCog,
  Building2,
  Shield,
  Receipt,
  Menu,
  X,
  Video,
  BrainCircuit,
  Network,
  ShieldAlert,
  Activity,
  Radar,
  AlertTriangle,
  Globe2,
  Link2,
  Syringe,
  Bell,
  LineChart,
  Megaphone,
  Microscope,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useResponsive } from '@/contexts/ResponsiveContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription, type FeatureKey } from '@/contexts/SubscriptionContext';
import { useSentinel } from '@/contexts/SentinelContext';
import type { PageType } from '@/types';
import type { SentinelTabId } from '@/types/sentinel';
import { BRAND } from '@/config/brand';
import vitalinkLogo from '@/assets/vitalink-logo.png';

interface SidebarProps {
  currentPage: PageType;
  onPageChange: (page: PageType) => void;
}

interface NavItem {
  id: PageType;
  label: string;
  icon: ElementType;
  module: string;
}

const SENTINEL_SUB_NAV: { tab: SentinelTabId; label: string; icon: ElementType }[] = [
  { tab: 'surveillance', label: 'Surveillance Dashboard', icon: LayoutDashboard },
  { tab: 'disease-tracking', label: 'Disease Tracking', icon: Activity },
  { tab: 'case-reporting', label: 'Case Reporting', icon: Radar },
  { tab: 'outbreak', label: 'Outbreak Intelligence', icon: AlertTriangle },
  { tab: 'heatmaps', label: 'Geographic Heatmaps', icon: Globe2 },
  { tab: 'contact-tracing', label: 'Contact Tracing', icon: Link2 },
  { tab: 'vaccination', label: 'Vaccination Monitoring', icon: Syringe },
  { tab: 'alerts', label: 'Public Health Alerts', icon: Bell },
  { tab: 'epidemiology-analytics', label: 'Epidemiology Analytics', icon: LineChart },
  { tab: 'emergency', label: 'Emergency Response', icon: Shield },
  { tab: 'community', label: 'Community Reporting', icon: Megaphone },
  { tab: 'ntd', label: 'NTD Monitoring', icon: Microscope },
];

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, module: 'Dashboard' },
  { id: 'patient-identity', label: 'Health Identity', icon: CreditCard, module: 'Patients' },
  { id: 'patients', label: 'Patients', icon: Users, module: 'Patients' },
  { id: 'emr', label: 'EMR', icon: FileText, module: 'EMR' },
  { id: 'telemedicine', label: 'Telemedicine', icon: Video, module: 'Appointments' },
  { id: 'ai-clinical-intelligence', label: 'AI Clinical Intelligence', icon: BrainCircuit, module: 'EMR' },
  { id: 'switch-network', label: BRAND.network, icon: Network, module: 'Administration' },
  { id: 'appointments', label: 'Appointments', icon: CalendarDays, module: 'Appointments' },
  { id: 'laboratory', label: 'Laboratory', icon: FlaskConical, module: 'Laboratory' },
  { id: 'pharmacy', label: 'Pharmacy', icon: Pill, module: 'Pharmacy' },
  { id: 'billing', label: 'Billing', icon: CreditCard, module: 'Billing' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, module: 'Analytics' },
  { id: 'switch-sentinel', label: BRAND.sentinel, icon: ShieldAlert, module: 'Public Health' },
  { id: 'human-resources', label: 'Human Resources', icon: UserCog, module: 'Human Resources' },
  { id: 'administration', label: 'Administration', icon: Building2, module: 'Administration' },
  { id: 'subscription', label: 'Subscription', icon: Receipt, module: 'Settings' },
  { id: 'audit-logs', label: 'Security', icon: Shield, module: 'Settings' },
];

const bottomNavItems: NavItem[] = [
  { id: 'settings', label: 'Settings', icon: Settings, module: 'Settings' },
];

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const { isMobile, sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed } = useResponsive();
  const { canView, isSuperAdmin } = useAuth();
  const { hasAccess } = useSubscription();

  const pageFeatureMap: Partial<Record<PageType, FeatureKey>> = {
    telemedicine: 'telemedicine',
    'ai-clinical-intelligence': 'ai_limited',
    'switch-network': 'multi_hospital',
    laboratory: 'laboratory',
    pharmacy: 'pharmacy',
    billing: 'billing',
    analytics: 'analytics_advanced',
    'switch-sentinel': 'public_health_sentinel',
  };

  const handleNavClick = (id: PageType) => {
    onPageChange(id);
    if (isMobile) setSidebarOpen(false);
  };

  const filteredNavItems = navItems.filter(item => {
    if (isSuperAdmin) return true;
    const canSeeByRole = canView(item.module);
    const requiredFeature = pageFeatureMap[item.id];
    const canSeeByPlan = requiredFeature ? hasAccess(requiredFeature) : true;
    return canSeeByRole && canSeeByPlan;
  });

  const filteredBottomNav = bottomNavItems.filter(item => {
    if (isSuperAdmin) return true;
    return canView(item.module);
  });

  // Mobile drawer
  if (isMobile) {
    return (
      <>
        {/* Mobile Toggle Button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="fixed top-4 left-4 z-50 p-2.5 rounded-xl bg-white/80 backdrop-blur-xl shadow-lg border border-gray-100/50"
        >
          {sidebarOpen ? <X className="w-5 h-5 text-gray-700" /> : <Menu className="w-5 h-5 text-gray-700" />}
        </button>

        {/* Mobile Drawer Overlay */}
        {sidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 animate-in fade-in duration-300"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Mobile Drawer */}
        <aside 
          className={cn(
            "fixed top-0 left-0 bottom-0 z-50 flex flex-col transition-all duration-300 ease-out",
            sidebarOpen ? "translate-x-0" : "-translate-x-full",
            "w-72"
          )}
          style={{ background: 'linear-gradient(180deg, #1E3A8A 0%, #1E4ED8 100%)' }}
        >
          <SidebarContent 
            currentPage={currentPage} 
            onPageChange={handleNavClick}
            expanded={true}
            navItems={filteredNavItems}
            bottomNavItems={filteredBottomNav}
            onToggle={() => setSidebarOpen(false)}
          />
        </aside>
      </>
    );
  }

  // Tablet & Desktop
  return (
    <aside
      className={cn(
        "flex flex-col transition-all duration-300 ease-out z-20 h-screen sticky top-0",
        sidebarCollapsed
          ? "w-16 md:w-14 lg:w-16 xl:w-16"
          : "w-[200px] md:w-[240px] lg:w-[260px] xl:w-[260px]"
      )}
      style={{ background: 'linear-gradient(180deg, #1E3A8A 0%, #1E4ED8 100%)' }}
    >
      <SidebarContent 
        currentPage={currentPage} 
        onPageChange={handleNavClick}
        expanded={!sidebarCollapsed}
        navItems={filteredNavItems}
        bottomNavItems={filteredBottomNav}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
    </aside>
  );
}

interface SidebarContentProps {
  currentPage: PageType;
  onPageChange: (page: PageType) => void;
  expanded: boolean;
  navItems: NavItem[];
  bottomNavItems: NavItem[];
  onToggle: () => void;
}

function SidebarContent({ currentPage, onPageChange, expanded, navItems, bottomNavItems, onToggle }: SidebarContentProps) {
  const { setActiveTab, allowedTabs, activeTab } = useSentinel();
  const [sentinelPublicOpen, setSentinelPublicOpen] = useState(true);

  return (
    <>
      {/* Logo */}
      <div className="h-20 px-5 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/95 flex items-center justify-center flex-shrink-0 border border-white/30 shadow-sm overflow-hidden">
            <img src={vitalinkLogo} alt={`${BRAND.name} logo`} className="h-8 w-8 object-contain" />
          </div>
          
          {expanded && (
            <div className="flex flex-col">
              <span className="font-bold text-white text-sm tracking-tight">{BRAND.name}</span>
              <span className="text-[10px] text-white/60 tracking-wider uppercase">Healthcare Platform</span>
            </div>
          )}
        </div>
        
        <button 
          onClick={onToggle}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all duration-200"
        >
          {expanded ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {/* Divider */}
      <div className="mx-5 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* Main Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto scrollbar-hide">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;

          if (item.id === 'switch-sentinel') {
            return (
              <Fragment key={item.id}>
                <button
                  type="button"
                  onClick={() => onPageChange('switch-sentinel')}
                  data-tour-id="sidebar-switch-sentinel"
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-white/15 text-white border border-white/25'
                      : 'text-white/60 hover:bg-white/10 hover:text-white border border-transparent',
                    !expanded && 'justify-center px-2',
                    'min-w-0',
                  )}
                  title={!expanded ? item.label : undefined}
                >
                  <Icon className={cn('w-5 h-5 flex-shrink-0 transition-transform duration-200', isActive && 'scale-110')} />
                  {expanded && <span className="truncate min-w-0 flex-1 text-left">{item.label}</span>}
                  {isActive && expanded && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-sky-300 animate-pulse" />}
                </button>

                {expanded && allowedTabs.length > 0 && (
                  <div className="mt-1 mb-2 rounded-xl border border-white/10 bg-white/5 px-2 py-2">
                    <button
                      type="button"
                      onClick={() => setSentinelPublicOpen((o) => !o)}
                      className="flex w-full items-center justify-between px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-white/50 hover:text-white/80"
                    >
                      <span>Public Health / Sentinel</span>
                      <ChevronDown className={cn('w-4 h-4 transition-transform', sentinelPublicOpen && 'rotate-180')} />
                    </button>
                    {sentinelPublicOpen && (
                      <div className="mt-1 max-h-[min(320px,42vh)] overflow-y-auto space-y-0.5 pr-1 scrollbar-hide">
                        {SENTINEL_SUB_NAV.filter((s) => allowedTabs.includes(s.tab)).map((s) => {
                          const SubIcon = s.icon;
                          const subActive = currentPage === 'switch-sentinel' && activeTab === s.tab;
                          return (
                            <button
                              key={s.tab}
                              type="button"
                              onClick={() => {
                                onPageChange('switch-sentinel');
                                setActiveTab(s.tab);
                              }}
                              className={cn(
                                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors min-w-0',
                                subActive
                                  ? 'bg-white/12 text-sky-100 border border-white/20'
                                  : 'text-white/55 hover:bg-white/10 hover:text-white border border-transparent',
                              )}
                            >
                              <SubIcon className="h-4 w-4 flex-shrink-0 opacity-90" />
                              <span className="leading-snug truncate min-w-0 flex-1 text-left">{s.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              data-tour-id={`sidebar-${item.id}`}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-white/15 text-white border border-white/25'
                  : 'text-white/60 hover:bg-white/10 hover:text-white border border-transparent',
                !expanded && 'justify-center px-2',
                'min-w-0',
              )}
              title={!expanded ? item.label : undefined}
            >
              <Icon className={cn('w-5 h-5 flex-shrink-0 transition-transform duration-200', isActive && 'scale-110')} />
              {expanded && <span className="truncate min-w-0 flex-1 text-left">{item.label}</span>}
              {expanded && item.id === 'subscription' && <Lock className="w-3.5 h-3.5 text-white/50 ml-auto flex-shrink-0" />}

              {isActive && expanded && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-sky-300 animate-pulse" />}
            </button>
          );
        })}
      </nav>

      {/* VitaMind AI Promo */}
      {expanded && (
        <div className="mx-4 mb-4 p-4 rounded-2xl bg-gradient-to-br from-[#6D28D9]/30 to-[#4C1D95]/20 border border-[#6D28D9]/35">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-violet-200" />
            <span className="text-xs font-semibold text-violet-100">{BRAND.assistant}</span>
          </div>
          <p className="text-[10px] text-white/70 mb-3 leading-snug">Clinical Intelligence for Better Healthcare</p>
          <button type="button" className="w-full py-2 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-medium transition-all duration-200">
            Open VitaMind
          </button>
        </div>
      )}

      {/* Bottom Navigation */}
      <div className="py-4 px-3 border-t border-white/10 space-y-1">
        {bottomNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              data-tour-id={`sidebar-${item.id}`}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200",
                isActive 
                  ? "bg-white/15 text-white border border-white/25" 
                  : "text-white/60 hover:bg-white/10 hover:text-white border border-transparent",
                !expanded && "justify-center px-2"
              )}
              title={!expanded ? item.label : undefined}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {expanded && <span className="truncate min-w-0 flex-1 text-left">{item.label}</span>}
            </button>
          );
        })}
        
        {/* Help */}
        <button
          onClick={() => onPageChange('help')}
          data-tour-id="sidebar-help"
          className={cn(
            "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 border",
            currentPage === 'help'
              ? "bg-white/15 text-white border-white/25"
              : "text-white/60 hover:bg-white/10 hover:text-white border-transparent",
            !expanded && "justify-center px-2"
          )}
          title={!expanded ? 'Help & Support' : undefined}
        >
          <HelpCircle className="w-5 h-5 flex-shrink-0" />
          {expanded && <span className="truncate min-w-0 flex-1 text-left">Help & Support</span>}
        </button>
      </div>

      {/* Version */}
      {expanded && (
        <div className="px-5 py-3 text-center">
          <span className="text-[10px] text-white/40">v2.0.0 • Offline-First</span>
        </div>
      )}
    </>
  );
}
