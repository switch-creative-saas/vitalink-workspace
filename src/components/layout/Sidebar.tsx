import { useEffect, useState, type ElementType } from 'react';
import { toast } from 'sonner';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { getEntitlements, openWorkspaceSentinel, type SentinelAccess } from '@/lib/supabase/plans';
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
  UserCog,
  Building2,
  Shield,
  ShieldCheck,
  Receipt,
  Menu,
  X,
  Video,
  BrainCircuit,
  Network,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useResponsive } from '@/contexts/ResponsiveContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePlan } from '@/hooks/usePlan';
import { usePlatformAdmin } from '@/hooks/usePlatformAdmin';
import type { PageType } from '@/types';
import { BRAND } from '@/config/brand';
import {
  BOTTOM_NAVIGATION,
  getNavigationForWorkspace,
  type NavigationIconKey,
} from '@/lib/workspace/navigation';
import { workspaceLabel } from '@/lib/workspace/organizationTypes';
import { SENTINEL_OPENER_ROLES } from '@/lib/workspace/roles';
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
  locked?: boolean;
  requiredPlan?: string;
}

const iconMap: Record<NavigationIconKey, ElementType> = {
  dashboard: LayoutDashboard,
  identity: CreditCard,
  patients: Users,
  emr: FileText,
  video: Video,
  ai: BrainCircuit,
  network: Network,
  appointments: CalendarDays,
  laboratory: FlaskConical,
  pharmacy: Pill,
  billing: CreditCard,
  analytics: BarChart3,
  hr: UserCog,
  administration: Building2,
  subscription: Receipt,
  audit: Shield,
  settings: Settings,
  'nfc-cards': CreditCard,
};

function hydrateNavigation(items: ReturnType<typeof getNavigationForWorkspace>): NavItem[] {
  return items.map((item) => ({
    ...item,
    icon: iconMap[item.icon],
  }));
}

export function Sidebar({ currentPage, onPageChange }: SidebarProps) {
  const { isMobile, sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed } = useResponsive();
  const { canAccessPage, organization, organizationType, workspaceType } = useAuth();
  const { hasModule } = usePlan();
  // Only VitaLink platform admins get a way into the private console.
  const showConsole = usePlatformAdmin() === true;
  const navItems = hydrateNavigation(getNavigationForWorkspace(workspaceType, organizationType));
  const bottomNavItems = hydrateNavigation(BOTTOM_NAVIGATION);

  const planRequirements: Partial<Record<PageType, string>> = {
    telemedicine: 'Growth Corridor', 'ai-clinical-intelligence': 'Growth Corridor', 'switch-network': 'Growth Corridor',
    laboratory: 'Growth Corridor', pharmacy: 'Growth Corridor', analytics: 'Growth Corridor', 'human-resources': 'Growth Corridor',
    administration: 'Enterprise', 'audit-logs': 'Enterprise',
  };

  const handleNavClick = (id: PageType) => {
    onPageChange(id);
    if (isMobile) setSidebarOpen(false);
  };

  const filteredNavItems = navItems.filter((item) => canAccessPage(item.id)).map((item) => ({
    ...item,
    locked: workspaceType !== 'public-health' && !hasModule(item.id),
    requiredPlan: planRequirements[item.id],
  }));

  const filteredBottomNav = bottomNavItems.filter(item => {
    return canAccessPage(item.id);
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
            workspaceName={workspaceLabel(workspaceType)}
            showConsole={showConsole}
          />
        </aside>
      </>
    );
  }

  // Tablet & Desktop
  return (
    <aside
      className={cn(
        // Above the page header, so the collapse button on the edge isn't covered.
        "relative flex flex-col transition-all duration-300 ease-out z-50 h-screen sticky top-0",
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
        workspaceName={workspaceLabel(organization.workspaceType)}
        showConsole={showConsole}
      />
      {/* Sits on the sidebar's outer edge so it stays visible (and clickable) when collapsed. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="absolute -right-3.5 top-[26px] z-30 flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-[#1E3A8A] shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}</TooltipContent>
      </Tooltip>
    </aside>
  );
}

interface SidebarContentProps {
  currentPage: PageType;
  onPageChange: (page: PageType) => void;
  expanded: boolean;
  navItems: NavItem[];
  bottomNavItems: NavItem[];
  /** Mobile drawer only: closes it. The desktop toggle sits on the sidebar edge. */
  onToggle?: () => void;
  workspaceName: string;
  showConsole?: boolean;
}

function SidebarContent({ currentPage, onPageChange, expanded, navItems, bottomNavItems, onToggle, workspaceName, showConsole }: SidebarContentProps) {
  const { organization, currentRole } = useAuth();
  const canOpenSentinel = SENTINEL_OPENER_ROLES.includes(currentRole);
  const [openingSentinel, setOpeningSentinel] = useState(false);
  const { plan } = usePlan();
  // What this workspace may do in Sentinel, known before the click so an unpaid workspace goes
  // straight to the add-on checkout instead of a new tab.
  const [sentinelAccess, setSentinelAccess] = useState<SentinelAccess | null>(isSupabaseConfigured ? null : 'full');
  useEffect(() => {
    if (!isSupabaseConfigured || !canOpenSentinel) return;
    let cancelled = false;
    getEntitlements(organization.id).then((e) => { if (!cancelled) setSentinelAccess(e.sentinelAccess); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [organization.id, canOpenSentinel, plan?.tierId, plan?.sentinelAddon]);

  const goToSentinelCheckout = () => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { path: '/subscription?addon=sentinel' } }));

  // Sentinel is its own app. Growth (read-only), Enterprise and the add-on open it; other plans go to the add-on checkout.
  const openSentinel = async () => {
    const sentinelUrl = import.meta.env.VITE_SENTINEL_WORKSPACE_URL ?? 'http://127.0.0.1:5173/';
    if (!isSupabaseConfigured) { window.open(sentinelUrl, '_blank', 'noopener'); return; }
    if (sentinelAccess !== 'read_only' && sentinelAccess !== 'full') { goToSentinelCheckout(); return; }
    const tab = window.open('', '_blank'); // opened now so the browser doesn't block it after the check
    setOpeningSentinel(true);
    try {
      const result = await openWorkspaceSentinel(organization.id);
      if (result.access === 'none') {
        tab?.close();
        setSentinelAccess('none');
        goToSentinelCheckout();
        return;
      }
      if (result.needsAdmin) {
        tab?.close();
        toast.info('A workspace admin needs to open Sentinel once to set it up for your facility.');
        return;
      }
      if (tab) { tab.opener = null; tab.location.href = sentinelUrl; } else window.open(sentinelUrl, '_blank', 'noopener');
    } catch (error) {
      tab?.close();
      toast.error(error instanceof Error ? error.message : 'Could not open Sentinel');
    } finally {
      setOpeningSentinel(false);
    }
  };
  return (
    <>
      {/* Logo */}
      <div className={cn('h-20 flex items-center flex-shrink-0', expanded ? 'px-5 justify-between' : 'px-2 justify-center')}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/95 flex items-center justify-center flex-shrink-0 border border-white/30 shadow-sm overflow-hidden">
            <img src={vitalinkLogo} alt={`${BRAND.name} logo`} className="h-8 w-8 object-contain" />
          </div>
          
          {expanded && (
            <div className="flex flex-col">
              <span className="font-bold text-white text-sm tracking-tight">{BRAND.name}</span>
              <span className="text-[10px] text-white/60 tracking-wider uppercase">{workspaceName}</span>
            </div>
          )}
        </div>
        
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Close menu"
            title="Close menu"
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors duration-200"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="mx-5 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* Main Navigation */}
      <nav data-tour-id="sidebar-nav" className="flex-1 py-4 px-3 space-y-1 overflow-y-auto scrollbar-hide">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;

          return (
            <button
              key={item.id}
              onClick={() => item.locked ? window.dispatchEvent(new CustomEvent('app:navigate', { detail: { path: '/subscription?upgrade=true' } })) : onPageChange(item.id)}
              data-tour-id={`sidebar-${item.id}`}
              className={cn(
                'group w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
                item.locked ? 'cursor-pointer text-white/40 hover:bg-white/10 hover:text-white/70 border border-transparent' : isActive
                  ? 'bg-white/15 text-white border border-white/25'
                  : 'text-white/60 hover:bg-white/10 hover:text-white border border-transparent',
                !expanded && 'justify-center px-2',
                'min-w-0',
              )}
              title={!expanded ? item.label : undefined}
            >
              <Icon className={cn('w-5 h-5 flex-shrink-0 transition-transform duration-200', isActive && 'scale-110')} />
              {expanded && <span className="truncate min-w-0 flex-1 text-left">{item.label}</span>}
              {item.locked && <Lock className="h-3.5 w-3.5 shrink-0 text-white/50" />}
              {expanded && item.locked && item.requiredPlan && <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-100 opacity-0 transition-opacity group-hover:opacity-100">{item.requiredPlan}</span>}

              {isActive && expanded && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-sky-300" />}
            </button>
          );
        })}
      </nav>

      {/* VitaLink Sentinel: the disease-surveillance dashboard is its own app (vitalink-sentinel). */}
      {expanded && canOpenSentinel && (
        <div className="mx-4 mb-4 p-4 rounded-2xl bg-gradient-to-br from-[#6D28D9]/30 to-[#4C1D95]/20 border border-[#6D28D9]/35">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-violet-200" />
            <span className="text-xs font-semibold text-violet-100">VitaLink Sentinel</span>
          </div>
          <p className="text-[10px] text-white/70 mb-3 leading-snug">Disease surveillance and outbreak intelligence</p>
          <button
            type="button"
            onClick={() => void openSentinel()}
            disabled={openingSentinel}
            className="block w-full py-2 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-center text-white text-xs font-medium transition-all duration-200 disabled:opacity-60"
          >
            {openingSentinel ? 'Opening…' : sentinelAccess === 'full' ? 'Open Sentinel' : sentinelAccess === 'read_only' ? 'Open Sentinel (read-only)' : 'Get Sentinel'}
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
        
        {showConsole && (
          <button
            onClick={() => window.open('/console', '_blank', 'noopener')}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 border border-violet-300/30 bg-violet-500/15 text-violet-50 hover:bg-violet-500/25',
              !expanded && 'justify-center px-2',
            )}
            title={!expanded ? 'VitaLink Console' : undefined}
          >
            <ShieldCheck className="w-5 h-5 flex-shrink-0" />
            {expanded && <span className="truncate min-w-0 flex-1 text-left">VitaLink Console</span>}
          </button>
        )}

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
