// Guided tours for the workspace: which tours this person can take (by role and plan), what they
// have finished, the welcome tour on first sign-in, and a gentle offer the first time they open
// a page that has a tour. The tours themselves live in lib/tours/workspaceTours.ts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { usePlan } from '@/hooks/usePlan';
import type { PageType } from '@/types';
import { loadTourProgress, resetTourProgress, saveTourStatus, type TourProgress, type TourStatus } from '@/lib/tours/progress';
import { isTourRunning, runTour, type TourStep } from '@/lib/tours/runTour';
import { pageTourId, WELCOME_TOUR_ID, WORKSPACE_TOURS, type WorkspaceTour } from '@/lib/tours/workspaceTours';

interface GuidedTourContextType {
  /** Tours this person can take, with steps for pages they can't open already removed. */
  tours: WorkspaceTour[];
  progress: TourProgress;
  startTour: (tourId: string) => void;
  /** The tour for the page on screen, if there is one. */
  currentPageTour: WorkspaceTour | null;
  /** Offer a page's tour the first time someone opens it. */
  offerPageTours: boolean;
  setOfferPageTours: (on: boolean) => void;
  resetProgress: () => Promise<void>;
}

const GuidedTourContext = createContext<GuidedTourContextType | null>(null);

// Pages every workspace has, whatever the plan.
const ALWAYS_OPEN = new Set<PageType>(['dashboard', 'settings', 'help', 'subscription']);
const OFFER_KEY = 'vitalink-tours-offer';

function readOfferSetting() {
  try { return localStorage.getItem(OFFER_KEY) !== 'off'; } catch { return true; }
}

/** Steps without a page stay on the page of the step before them. */
function withPages<Step extends TourStep<PageType>>(steps: Step[], startPage?: PageType): Step[] {
  let page = startPage;
  return steps.map((step) => {
    page = step.page ?? page;
    return { ...step, page };
  });
}

export function GuidedTourProvider({ currentPage, currentRole, userName, onNavigate, children }: {
  currentPage: PageType;
  currentRole: UserRole;
  userName: string;
  onNavigate: (page: PageType) => void;
  children: ReactNode;
}) {
  const { canAccessPage } = useAuth();
  const { hasModule } = usePlan();
  const [progress, setProgress] = useState<TourProgress>({});
  const [loaded, setLoaded] = useState(false);
  const [offerPageTours, setOfferState] = useState(readOfferSetting);
  const pageRef = useRef(currentPage);
  const offeredThisSession = useRef(new Set<string>());
  useEffect(() => { pageRef.current = currentPage; }, [currentPage]);

  useEffect(() => {
    let alive = true;
    loadTourProgress().then((saved) => { if (alive) { setProgress(saved); setLoaded(true); } }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [userName]);

  const canOpen = useCallback((page: PageType) => canAccessPage(page) && (ALWAYS_OPEN.has(page) || hasModule(page)), [canAccessPage, hasModule]);

  const tours = useMemo(() => {
    const firstName = userName.trim().split(/\s+/)[0];
    return WORKSPACE_TOURS
      .filter((tour) => (!tour.roles || tour.roles.includes(currentRole)) && (!tour.page || canOpen(tour.page)))
      .map((tour) => {
        const steps = withPages(tour.steps, tour.page)
          .filter((step) => (!step.roles || step.roles.includes(currentRole)) && (!step.page || canOpen(step.page)))
          .map((step, index) => (tour.id === WELCOME_TOUR_ID && index === 0 && firstName ? { ...step, title: `Welcome to VitaLink, ${firstName}` } : step));
        return { ...tour, steps };
      })
      .filter((tour) => tour.steps.length > 0);
  }, [canOpen, currentRole, userName]);

  const record = useCallback((tourId: string, status: TourStatus) => {
    setProgress((current) => ({ ...current, [tourId]: current[tourId] === 'completed' ? 'completed' : status }));
    void saveTourStatus(tourId, status).catch(() => undefined);
  }, []);

  const startTour = useCallback((tourId: string) => {
    const tour = tours.find((item) => item.id === tourId);
    if (!tour) return;
    toast.dismiss('tour-offer');
    runTour<PageType>({
      steps: tour.steps,
      getPage: () => pageRef.current,
      navigate: onNavigate,
      onEnd: (completed) => record(tour.id, completed ? 'completed' : 'dismissed'),
    });
  }, [onNavigate, record, tours]);

  // First sign-in: the welcome tour, once the workspace setup wizard (if any) is out of the way.
  useEffect(() => {
    if (!loaded || progress[WELCOME_TOUR_ID]) return;
    const timer = window.setTimeout(() => {
      const guard = (window as Window & { __vitalinkOnboardingRouteGuard?: () => boolean }).__vitalinkOnboardingRouteGuard;
      if (guard && !guard()) return;
      if (!isTourRunning()) startTour(WELCOME_TOUR_ID);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [loaded, progress, startTour]);

  const currentPageTour = useMemo(() => tours.find((tour) => tour.id === pageTourId(currentPage)) ?? null, [tours, currentPage]);

  // First visit to a page: offer its tour (once per session, never again after "Not now").
  useEffect(() => {
    if (!loaded || !offerPageTours || !progress[WELCOME_TOUR_ID] || !currentPageTour) return;
    const id = currentPageTour.id;
    if (progress[id] || offeredThisSession.current.has(id)) return;
    const timer = window.setTimeout(() => {
      if (isTourRunning()) return;
      offeredThisSession.current.add(id);
      toast(`New to ${currentPageTour.title}?`, {
        id: 'tour-offer',
        description: `Take a ${currentPageTour.minutes}-minute tour of this page.`,
        duration: 12000,
        action: { label: 'Show me', onClick: () => startTour(id) },
        cancel: { label: 'Not now', onClick: () => record(id, 'dismissed') },
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [currentPageTour, loaded, offerPageTours, progress, record, startTour]);

  const setOfferPageTours = useCallback((on: boolean) => {
    setOfferState(on);
    try { localStorage.setItem(OFFER_KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ }
  }, []);

  const resetProgress = useCallback(async () => {
    await resetTourProgress();
    offeredThisSession.current.clear();
    setProgress({});
  }, []);

  const value = useMemo(() => ({ tours, progress, startTour, currentPageTour, offerPageTours, setOfferPageTours, resetProgress }),
    [tours, progress, startTour, currentPageTour, offerPageTours, setOfferPageTours, resetProgress]);

  return <GuidedTourContext.Provider value={value}>{children}</GuidedTourContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useGuidedTour() {
  const context = useContext(GuidedTourContext);
  if (!context) throw new Error('useGuidedTour must be used inside GuidedTourProvider');
  return context;
}
