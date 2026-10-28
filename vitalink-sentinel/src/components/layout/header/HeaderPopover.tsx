import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { iconButtonClass } from '../navigation';

/** A round header button with a panel that drops down beneath it. */
export function HeaderPopover({ label, tourId, trigger, badge, onOpenChange, className, panelClassName, children }: {
  label: string;
  /** `data-tour-id` for guided tours. */
  tourId?: string;
  trigger: ReactNode;
  /** Small red marker on the button: a count, or `true` for a dot. */
  badge?: number | boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const change = (next: boolean) => { setOpen(next); onOpenChange?.(next); };

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) { setOpen(false); onOpenChange?.(false); } };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); onOpenChange?.(false); } };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open, onOpenChange]);

  return <div ref={ref} className="relative">
    <button type="button" data-tour-id={tourId} aria-label={label} title={label} aria-expanded={open} onClick={() => change(!open)} className={cn(iconButtonClass, open && 'bg-white text-slate-950 dark:bg-white/[0.14] dark:text-white', className)}>
      {trigger}
      {typeof badge === 'number' && badge > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white ring-2 ring-[#e8ebf1] dark:ring-[#0d0e14]">{badge > 99 ? '99+' : badge}</span>}
      {badge === true && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-[#1a1b24]" />}
    </button>
    {open && <div className={cn('sentinel-panel absolute right-0 top-[calc(100%+10px)] z-50 w-[min(92vw,380px)] overflow-hidden rounded-[24px]', panelClassName)}>{children(() => change(false))}</div>}
  </div>;
}

