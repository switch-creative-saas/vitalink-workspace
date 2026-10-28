// Sentinel guided tours: the welcome tour on first sign-in, an offer the first time someone opens
// a page with a tour, and the question-mark menu in the header. Tours: lib/tours/sentinelTours.ts.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, CircleHelp, Compass, PlayCircle, Route } from 'lucide-react';
import { toast } from 'sonner';
import { useSentinelStore, type SentinelRoute } from '@/store/useSentinelStore';
import { loadTourProgress, saveTourStatus, type TourProgress, type TourStatus } from '@/lib/tours/progress';
import { isTourRunning, runTour } from '@/lib/tours/runTour';
import { SENTINEL_TOURS, SENTINEL_WELCOME_ID, sentinelPageTourId, type SentinelTour } from '@/lib/tours/sentinelTours';
import { HeaderPopover } from '@/components/layout/header/HeaderPopover';

interface ToursContext {
  tours: SentinelTour[];
  progress: TourProgress;
  pageTour: SentinelTour | null;
  startTour: (id: string) => void;
}

const Context = createContext<ToursContext | null>(null);

export function SentinelToursProvider({ children }: { children: ReactNode }) {
  const { route, navigate, me } = useSentinelStore();
  const [progress, setProgress] = useState<TourProgress>({});
  const [loaded, setLoaded] = useState(false);
  const routeRef = useRef(route);
  const offered = useRef(new Set<string>());
  useEffect(() => { routeRef.current = route; }, [route]);

  const userId = me?.userId;
  useEffect(() => {
    let alive = true;
    loadTourProgress().then((saved) => { if (alive) { setProgress(saved); setLoaded(true); } }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [userId]);

  // Steps for actions this person's role can't take are left out.
  const tours = useMemo(() => SENTINEL_TOURS.map((tour) => {
    let page = tour.route;
    const steps = tour.steps
      .map((step) => { page = step.page ?? page; return { ...step, page }; })
      .filter((step) => !step.roles || !me || step.roles.includes(me.role));
    return { ...tour, steps };
  }).filter((tour) => tour.steps.length > 0), [me]);

  const record = useCallback((id: string, status: TourStatus) => {
    setProgress((current) => ({ ...current, [id]: current[id] === 'completed' ? 'completed' : status }));
    void saveTourStatus(id, status).catch(() => undefined);
  }, []);

  const startTour = useCallback((id: string) => {
    const tour = tours.find((item) => item.id === id);
    if (!tour) return;
    toast.dismiss('tour-offer');
    runTour<SentinelRoute>({
      steps: tour.steps,
      getPage: () => routeRef.current,
      navigate: (next) => navigate(next),
      onEnd: (completed) => record(id, completed ? 'completed' : 'dismissed'),
    });
  }, [navigate, record, tours]);

  useEffect(() => {
    if (!loaded || progress[SENTINEL_WELCOME_ID]) return;
    const timer = window.setTimeout(() => { if (!isTourRunning()) startTour(SENTINEL_WELCOME_ID); }, 1500);
    return () => window.clearTimeout(timer);
  }, [loaded, progress, startTour]);

  const pageTour = useMemo(() => tours.find((tour) => tour.id === sentinelPageTourId(route)) ?? null, [tours, route]);

  useEffect(() => {
    if (!loaded || !progress[SENTINEL_WELCOME_ID] || !pageTour) return;
    const id = pageTour.id;
    if (progress[id] || offered.current.has(id)) return;
    const timer = window.setTimeout(() => {
      if (isTourRunning()) return;
      offered.current.add(id);
      toast(`New to ${pageTour.title}?`, {
        id: 'tour-offer',
        description: `Take a ${pageTour.minutes}-minute tour of this page.`,
        duration: 12000,
        action: { label: 'Show me', onClick: () => startTour(id) },
        cancel: { label: 'Not now', onClick: () => record(id, 'dismissed') },
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [loaded, pageTour, progress, record, startTour]);

  const value = useMemo(() => ({ tours, progress, pageTour, startTour }), [tours, progress, pageTour, startTour]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The question-mark button: tour this page, getting started, or any tour. */
export function TourMenu() {
  const context = useContext(Context);
  if (!context) return null;
  const { tours, progress, pageTour, startTour } = context;
  const done = (id: string) => progress[id] === 'completed';
  const item = 'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-900/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.07]';
  const tick = (id: string) => done(id) && <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-emerald-500" />;

  return (
    <HeaderPopover label="Guided tours" tourId="tour-button" trigger={<CircleHelp className="h-[18px] w-[18px]" />} panelClassName="w-[min(92vw,320px)]">
      {(close) => <>
        <div className="px-5 pb-2 pt-4"><p className="text-sm font-semibold text-slate-950 dark:text-white">Guided tours</p><p className="text-xs text-slate-500 dark:text-slate-400">{tours.filter((t) => done(t.id)).length} of {tours.length} finished</p></div>
        <div className="px-2 pb-2">
          {pageTour && <button type="button" className={item} onClick={() => { close(); startTour(pageTour.id); }}><Compass className="h-4 w-4 text-slate-400" />Tour this page{tick(pageTour.id)}</button>}
          <button type="button" className={item} onClick={() => { close(); startTour(SENTINEL_WELCOME_ID); }}><Route className="h-4 w-4 text-slate-400" />Getting started{tick(SENTINEL_WELCOME_ID)}</button>
          <div className="my-1 h-px bg-slate-900/[0.06] dark:bg-white/10" />
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Page by page</p>
          {tours.filter((t) => t.route).map((t) => (
            <button key={t.id} type="button" className={item} onClick={() => { close(); startTour(t.id); }}>
              <PlayCircle className="h-4 w-4 text-slate-400" /><span className="min-w-0 flex-1 truncate">{t.title}</span>{tick(t.id)}
            </button>
          ))}
        </div>
      </>}
    </HeaderPopover>
  );
}
