// The question-mark button in the header: tour this page, the getting-started tour, or every tour.
import { CheckCircle2, CircleHelp, Compass, ListChecks, Route } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useGuidedTour } from '@/contexts/GuidedTourContext';
import { WELCOME_TOUR_ID } from '@/lib/tours/workspaceTours';

export function TourMenu({ onOpenHelp }: { onOpenHelp: () => void }) {
  const { tours, progress, startTour, currentPageTour } = useGuidedTour();
  const journey = tours.find((tour) => tour.id === 'patient-journey');
  const done = (id: string) => progress[id] === 'completed';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-tour-id="tour-button" title="Guided tours" aria-label="Guided tours"
          className="relative p-2.5 rounded-xl bg-[color:var(--bg-card)]/70 border border-[color:var(--border)] text-[color:var(--text-primary)] transition-all duration-200 hover:shadow-md">
          <CircleHelp className="w-5 h-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-50 w-64 glass-panel border-[color:var(--border)]">
        <DropdownMenuLabel className="text-xs font-medium text-[color:var(--text-secondary)]">Guided tours</DropdownMenuLabel>
        {currentPageTour && (
          <DropdownMenuItem onClick={() => startTour(currentPageTour.id)}>
            <Compass className="w-4 h-4 mr-2 text-royal-600" />
            <span className="flex-1">Tour this page</span>
            {done(currentPageTour.id) && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => startTour(WELCOME_TOUR_ID)}>
          <Route className="w-4 h-4 mr-2 text-royal-600" />
          <span className="flex-1">Getting started</span>
          {done(WELCOME_TOUR_ID) && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
        </DropdownMenuItem>
        {journey && (
          <DropdownMenuItem onClick={() => startTour(journey.id)}>
            <Route className="w-4 h-4 mr-2 text-royal-600" />
            <span className="flex-1">A patient visit, start to finish</span>
            {done(journey.id) && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onOpenHelp}>
          <ListChecks className="w-4 h-4 mr-2 text-royal-600" />
          All tours and help
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
