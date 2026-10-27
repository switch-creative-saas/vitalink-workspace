// Administration → Facility Settings: which public health organisations
// (VitaLink Sentinel users such as ministries, NCDC or NGOs) receive this
// hospital's de-identified disease reports. Nothing is shared until an admin approves.
import { useCallback, useEffect, useState } from 'react';
import { Check, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { listSentinelLinks, respondToSentinelLink, type SentinelLink } from '@/lib/supabase/sentinelSharing';

const STATUS = {
  pending: { label: 'Waiting for your decision', tone: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Sharing', tone: 'bg-green-100 text-green-700' },
  declined: { label: 'Declined', tone: 'bg-gray-100 text-gray-600' },
  revoked: { label: 'Stopped', tone: 'bg-gray-100 text-gray-600' },
} as const;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function PublicHealthSharing({ organizationId }: { organizationId: string }) {
  const [links, setLinks] = useState<SentinelLink[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    listSentinelLinks(organizationId).then(setLinks).catch(() => setLinks([]));
  }, [organizationId]);
  useEffect(() => { load(); }, [load]);

  const decide = async (link: SentinelLink, decision: 'approved' | 'declined' | 'revoked') => {
    setBusy(link.id);
    try {
      await respondToSentinelLink(link.id, decision);
      toast.success(decision === 'approved' ? `Now sharing with ${link.sentinelOrg}` : decision === 'revoked' ? `Stopped sharing with ${link.sentinelOrg}` : 'Request declined');
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save your decision');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="premium-card p-5">
      <div className="mb-3 flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-royal-600" />
        <div>
          <h3 className="font-semibold text-gray-900">Public health data sharing</h3>
          <p className="mt-1 text-sm text-gray-500">
            Disease surveillance bodies using VitaLink Sentinel can ask to receive reports of notifiable diseases and daily symptom counts from this facility.
            Reports never include names, phone numbers, addresses or record numbers: only disease, status, age group, sex, state and symptoms.
          </p>
        </div>
      </div>
      {links === null ? <p className="text-sm text-gray-500">Loading…</p> : links.length === 0 ? (
        <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-500">No organisation has asked for data from this facility.</p>
      ) : (
        <div className="space-y-2">
          {links.map((link) => (
            <div key={link.id} className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-gray-900">{link.sentinelOrg}</p>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs', STATUS[link.status].tone)}>{STATUS[link.status].label}</span>
                </div>
                <p className="text-xs text-gray-500">
                  {link.sentinelType}{link.sentinelState ? ` · ${link.sentinelState}` : ''} · asked {day(link.requestedAt)}
                  {link.status === 'approved' && ` · ${link.casesShared} case${link.casesShared === 1 ? '' : 's'} shared${link.lastReportDate ? `, last ${day(link.lastReportDate)}` : ''}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {link.status === 'pending' && (
                  <>
                    <Button size="sm" className="bg-royal-600 text-white hover:bg-royal-700" disabled={busy === link.id} onClick={() => void decide(link, 'approved')}><Check className="mr-1 h-4 w-4" />Approve</Button>
                    <Button size="sm" variant="outline" disabled={busy === link.id} onClick={() => void decide(link, 'declined')}><X className="mr-1 h-4 w-4" />Decline</Button>
                  </>
                )}
                {link.status === 'approved' && (
                  <Button size="sm" variant="outline" className="border-red-200 text-red-600 hover:bg-red-50" disabled={busy === link.id} onClick={() => void decide(link, 'revoked')}>Stop sharing</Button>
                )}
                {(link.status === 'declined' || link.status === 'revoked') && (
                  <Button size="sm" variant="outline" disabled={busy === link.id} onClick={() => void decide(link, 'approved')}>Share again</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
