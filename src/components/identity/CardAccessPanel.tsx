// Staff side of a patient's VitaCard link: set it up with the PIN the patient chooses (typed by the
// patient on this screen), write the link onto the card or print it as a QR code, reset a
// forgotten PIN, or switch a lost card off. See lib/supabase/vitacard.ts.
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, KeyRound, Loader2, Lock, Nfc, Power, Printer, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { escapeHtml } from '@/lib/printDocument';
import { cardLink, disableCard, getActiveCard, issueCard, pinProblem, setCardPin, writeCardTag, type PatientCard } from '@/lib/supabase/vitacard';
import type { RegistryPatient } from '@/lib/patientRegistry';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export function CardAccessPanel({ patient, onChange }: { patient: Pick<RegistryPatient, 'id' | 'firstName' | 'lastName' | 'switchId'>; onChange?: () => void }) {
  const [card, setCard] = useState<PatientCard | null | undefined>(undefined);
  const [qr, setQr] = useState('');
  const [pinFor, setPinFor] = useState<'issue' | 'reset' | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(() => {
    getActiveCard(patient.id).then((found) => { setLoadedAt(Date.now()); setCard(found); }).catch(() => setCard(null));
  }, [patient.id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!card) return;
    QRCode.toDataURL(cardLink(card.token), { margin: 1, width: 240 }).then(setQr).catch(() => setQr(''));
  }, [card]);

  const copy = () => {
    if (!card) return;
    void navigator.clipboard?.writeText(cardLink(card.token)).then(() => toast.success('Card link copied'), () => toast.message('Card link', { description: cardLink(card.token) }));
  };

  const write = async () => {
    if (!card) return;
    try {
      const result = await writeCardTag(card.token);
      if (result === 'written') toast.success('Link written to the card');
      else { copy(); toast.info('This browser can’t write NFC cards (use Chrome on Android). The link was copied so it can be written with a card writer app.'); }
    } catch (error) {
      toast.error(errorText(error, 'Could not write to the card. Hold it still against the back of the phone.'));
    }
  };

  const printQr = () => {
    if (!card || !qr) return;
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>VitaCard QR</title><style>@page{size:85.6mm 54mm;margin:4mm}body{font-family:system-ui,sans-serif;margin:0;display:flex;gap:4mm;align-items:center}img{width:40mm;height:40mm}p{margin:0;font-size:9pt}</style></head><body>
<img src="${qr}" alt=""><div><p><strong>${escapeHtml(`${patient.firstName} ${patient.lastName}`)}</strong></p><p>${escapeHtml(patient.switchId)}</p><p style="margin-top:2mm;font-size:7.5pt">In an emergency, scan or tap this card for medical information.</p></div></body></html>`;
    frame.onload = () => { frame.contentWindow?.print(); window.setTimeout(() => frame.remove(), 60_000); };
    document.body.appendChild(frame);
  };

  const off = async () => {
    if (!card || !window.confirm('Switch this card off? Its link stops working straight away. Use this for a lost or replaced card.')) return;
    try { await disableCard(card.id); toast.success('Card switched off'); load(); onChange?.(); }
    catch (error) { toast.error(errorText(error, 'Could not switch the card off')); }
  };

  if (card === undefined) return null;
  const locked = card?.lockedUntil && new Date(card.lockedUntil).getTime() > loadedAt;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-50 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-royal-600" />Card access for the patient</h3>
      {!card ? (
        <div className="rounded-lg border border-dashed border-gray-200 p-3 text-sm dark:border-slate-700">
          <p className="text-slate-600 dark:text-slate-300">Not set up. Once set up, tapping or scanning the card shows the emergency profile to anyone, and the patient’s PIN opens their full record.</p>
          <Button size="sm" className="mt-2 gap-1.5 bg-royal-600 text-white hover:bg-royal-700" onClick={() => setPinFor('issue')}><KeyRound className="h-4 w-4" />Set up card link and PIN</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-3 rounded-lg border border-gray-100 p-3 text-sm dark:border-slate-700">
          {qr && <img src={qr} alt="Card link QR code" className="h-24 w-24 shrink-0 rounded-lg bg-white p-1" />}
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="truncate font-mono text-xs text-slate-500" title={cardLink(card.token)}>{cardLink(card.token)}</p>
            <p className="text-xs text-slate-500">
              Set up {new Date(card.createdAt).toLocaleDateString()}{card.lastUsedAt ? ` · last opened ${new Date(card.lastUsedAt).toLocaleString()}` : ' · not opened yet'}
            </p>
            {locked && <p className="flex items-center gap-1 text-xs text-amber-700"><Lock className="h-3 w-3" />PIN locked after wrong attempts until {new Date(card.lockedUntil as string).toLocaleTimeString()}. Resetting the PIN unlocks it.</p>}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Button size="sm" variant="outline" className="gap-1" onClick={() => void write()}><Nfc className="h-3.5 w-3.5" />Write to card</Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={copy}><Copy className="h-3.5 w-3.5" />Copy link</Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={printQr}><Printer className="h-3.5 w-3.5" />Print QR</Button>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setPinFor('reset')}><KeyRound className="h-3.5 w-3.5" />Reset PIN</Button>
              <Button size="sm" variant="ghost" className="gap-1 text-red-600" onClick={() => void off()}><Power className="h-3.5 w-3.5" />Switch off</Button>
            </div>
          </div>
        </div>
      )}
      <PinDialog
        open={pinFor !== null}
        mode={pinFor ?? 'issue'}
        patientName={patient.firstName}
        onClose={() => setPinFor(null)}
        onSave={async (pin) => {
          if (pinFor === 'reset' && card) { await setCardPin(card.id, pin); toast.success('PIN changed'); }
          else { await issueCard(patient.id, pin); toast.success('Card link ready. Write it to the card or print the QR.'); }
          setPinFor(null);
          load();
          onChange?.();
        }}
      />
    </div>
  );
}

/** The patient types their own PIN (twice) on the staff device. It never appears on screen. */
function PinDialog({ open, mode, patientName, onClose, onSave }: {
  open: boolean; mode: 'issue' | 'reset'; patientName: string; onClose: () => void; onSave: (pin: string) => Promise<void>;
}) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const reset = () => { setPin(''); setAgain(''); setBusy(false); };
  const problem = pin ? pinProblem(pin) : null;
  const mismatch = again.length > 0 && again !== pin;

  const save = async () => {
    if (problem || pin !== again) return;
    setBusy(true);
    try { await onSave(pin); reset(); }
    catch (error) { toast.error(errorText(error, 'Could not save the PIN')); setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === 'reset' ? 'New card PIN' : 'Choose a card PIN'}</DialogTitle>
          <DialogDescription>Hand the device to {patientName}. They type a 4–6 digit PIN only they know; it opens their full record when they tap the card.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} placeholder="PIN" value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="text-center text-lg tracking-[0.5em]" autoFocus />
          <Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} placeholder="PIN again" value={again}
            onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} className="text-center text-lg tracking-[0.5em]" />
          {(problem || mismatch) && <p className="text-xs text-red-600">{problem ?? 'The two PINs don’t match.'}</p>}
          <p className="text-xs text-slate-500">VitaLink stores only a scrambled version of the PIN. Staff can set a new one, but nobody can see it.</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" disabled={busy || !pin || Boolean(problem) || pin !== again} className="gap-1.5 bg-royal-600 text-white hover:bg-royal-700">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}Save PIN
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
