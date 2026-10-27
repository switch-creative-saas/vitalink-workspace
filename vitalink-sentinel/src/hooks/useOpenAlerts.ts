import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { countAlerts, subscribeToAlerts } from '@/lib/supabase/sentinel';

/**
 * Number of open alerts for the signed-in organisation, kept live. New high and critical
 * alerts also pop up wherever the user is in Sentinel.
 */
export function useOpenAlerts(orgId: string | undefined, onOpen?: () => void): number {
  const [open, setOpen] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured || !orgId) return;
    let alive = true;
    const refresh = () => countAlerts(orgId).then((c) => { if (alive) setOpen(c.open); }).catch(() => undefined);
    void refresh();
    const unsubscribe = subscribeToAlerts(orgId, (alert, event) => {
      void refresh();
      if (event === 'INSERT' && (alert.severity === 'critical' || alert.severity === 'high')) {
        const show = alert.severity === 'critical' ? toast.error : toast.warning;
        show(alert.title, { description: alert.message ?? undefined, duration: 12000, action: onOpen ? { label: 'View', onClick: onOpen } : undefined });
      }
    });
    return () => { alive = false; unsubscribe(); };
  }, [orgId, onOpen]);

  return open;
}
