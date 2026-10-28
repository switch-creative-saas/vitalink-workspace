// Every guided tour this person can take, with what they've already finished.
import { CheckCircle2, Clock, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGuidedTour } from '@/contexts/GuidedTourContext';

export function GuidedToursList() {
  const { tours, progress, startTour } = useGuidedTour();
  const general = tours.filter((tour) => !tour.page);
  const pages = tours.filter((tour) => tour.page);
  const finished = tours.filter((tour) => progress[tour.id] === 'completed').length;

  const row = (tour: (typeof tours)[number]) => {
    const done = progress[tour.id] === 'completed';
    return (
      <li key={tour.id} className="flex items-center gap-3 py-3">
        <span className={done ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600'}><CheckCircle2 className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{tour.title}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{tour.summary}</p>
        </div>
        <span className="hidden shrink-0 items-center gap-1 text-xs text-slate-400 sm:flex"><Clock className="h-3.5 w-3.5" />{tour.minutes} min</span>
        <Button size="sm" variant={done ? 'outline' : 'default'} className="shrink-0 gap-1.5" onClick={() => startTour(tour.id)}>
          <PlayCircle className="h-4 w-4" />{done ? 'Replay' : 'Start'}
        </Button>
      </li>
    );
  };

  return (
    <div data-tour-id="help-tours" className="premium-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-50">Guided tours</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">Short, step-by-step walkthroughs of VitaLink. Each one opens the right page for you.</p>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{finished} of {tours.length} finished</p>
      </div>
      <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">{general.map(row)}</ul>
      {pages.length > 0 && (
        <>
          <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Page by page</p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">{pages.map(row)}</ul>
        </>
      )}
    </div>
  );
}
