// Runs a guided tour with Driver.js. Steps can live on different pages: before each step the
// tour opens that step's page and waits for its element. A step whose element never appears
// (hidden for this role, an empty list, a small screen) is skipped rather than pointing at nothing.
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tours.css';

export interface TourStep<Page extends string = string> {
  /** Page the step belongs to; the tour opens it first. */
  page?: Page;
  /** A `data-tour-id` marker. Leave out for a message in the middle of the screen. */
  element?: string;
  /** Highlight the card around the marker instead of the marker itself (for section headings). */
  card?: boolean;
  title: string;
  body: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function isVisible(el: Element) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function resolveElement(step: TourStep): Element | null {
  if (!step.element) return null;
  const el = [...document.querySelectorAll(`[data-tour-id="${step.element}"]`)].find(isVisible);
  if (!el) return null;
  return step.card ? el.closest('.sentinel-card, .sentinel-panel, section, aside') ?? el : el;
}

async function waitForElement(step: TourStep, timeoutMs = 3500) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const el = resolveElement(step);
    if (el) return el;
    await sleep(120);
  }
  return null;
}

// The tour on screen (or about to be: it may still be waiting for its first element).
let activeTour: { tour: Driver; cancel: () => void } | null = null;

export function isTourRunning() {
  return activeTour !== null;
}

export function runTour<Page extends string>({ steps, getPage, navigate, onEnd }: {
  steps: TourStep<Page>[];
  getPage: () => Page;
  navigate: (page: Page) => void;
  /** completed: the person reached the last step; otherwise they closed it early. */
  onEnd: (completed: boolean) => void;
}) {
  activeTour?.cancel();
  let current = -1;
  let ended = false;
  let moving = false;
  let cancelled = false;
  const finish = (completed: boolean) => {
    if (ended) return;
    ended = true;
    onEnd(completed);
  };

  const tour = driver({
    animate: true,
    smoothScroll: true,
    allowClose: true,
    overlayOpacity: 0.55,
    stagePadding: 8,
    stageRadius: 14,
    popoverClass: 'vl-tour',
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Finish',
    steps: steps.map((step) => ({
      element: step.element ? () => resolveElement(step) ?? document.body : undefined,
      popover: { title: step.title, description: step.body, side: step.side, align: 'start' as const },
    })),
    onNextClick: () => { void go(current + 1, 1); },
    onPrevClick: () => { void go(current - 1, -1); },
    onCloseClick: () => { finish(false); tour.destroy(); },
    onDestroyed: () => {
      finish(false);
      if (activeTour?.tour === tour) activeTour = null;
    },
  });

  async function go(target: number, direction: 1 | -1) {
    if (moving) return;
    moving = true;
    try {
      while (target >= 0 && target < steps.length) {
        const step = steps[target];
        if (step.page && step.page !== getPage()) {
          navigate(step.page);
          await sleep(300);
        }
        if (!step.element || await waitForElement(step)) break;
        if (cancelled) return;
        target += direction;
      }
      // Another tour started (or this one was closed) while we were waiting.
      if (cancelled) return;
      if (target >= steps.length) {
        finish(true);
        tour.destroy();
        if (activeTour?.tour === tour) activeTour = null;
        return;
      }
      if (target < 0) {
        if (!tour.isActive() && activeTour?.tour === tour) activeTour = null;
        return;
      }
      current = target;
      if (tour.isActive()) tour.moveTo(target);
      else tour.drive(target);
    } finally {
      moving = false;
    }
  }

  const cancel = () => {
    cancelled = true;
    if (tour.isActive()) tour.destroy();
    if (activeTour?.tour === tour) activeTour = null;
  };
  activeTour = { tour, cancel };
  void go(0, 1);
  return cancel;
}
