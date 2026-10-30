// Public side of a VitaCard tap (https://<app>/card/<token>). No sign-in: the card's random token
// identifies it, and the patient's PIN unlocks the full record. Runs the card_* database functions
// with the service role (they are not callable otherwise) and turns stored photos into short-lived
// signed links.
//
//   { action: 'emergency', token }       -> emergency profile (life-saving basics) or 404
//   { action: 'unlock', token, pin }     -> { ok, session, expiresAt } | { ok: false, reason, attemptsLeft?, until? }
//   { action: 'records', session }       -> full record, or 401 once the 15-minute session ends
//   { action: 'lock', session }          -> ends the session
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const TOKEN = /^[A-Za-z0-9_-]{20,40}$/;
const SESSION = /^[0-9a-f]{64}$/;

/** Patient photos are stored privately as "storage:<path>"; give the page a 10-minute link. */
async function photoLink(value: unknown): Promise<string | null> {
  if (typeof value !== 'string' || !value) return null;
  if (!value.startsWith('storage:')) return value;
  const { data } = await db.storage.from('patient-documents').createSignedUrl(value.slice('storage:'.length), 600);
  return data?.signedUrl ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const body = await req.json().catch(() => ({}));

  try {
    if (body.action === 'emergency') {
      if (!TOKEN.test(String(body.token ?? ''))) return json({ error: 'This card link isn’t valid.' }, 404);
      const { data, error } = await db.rpc('card_emergency', { p_token: body.token });
      if (error) return json({ error: error.code === '53400' ? error.message : 'Could not read this card right now.' }, error.code === '53400' ? 429 : 500);
      if (!data) return json({ error: 'This card isn’t active. It may have been replaced or reported lost.' }, 404);
      return json({ ...data, photo: await photoLink(data.photo) });
    }

    if (body.action === 'unlock') {
      if (!TOKEN.test(String(body.token ?? ''))) return json({ error: 'This card link isn’t valid.' }, 404);
      const pin = String(body.pin ?? '');
      if (!/^[0-9]{4,6}$/.test(pin)) return json({ ok: false, reason: 'wrong_pin' });
      const { data, error } = await db.rpc('card_unlock', { p_token: body.token, p_pin: pin });
      if (error) return json({ error: 'Could not check the PIN right now.' }, 500);
      return json(data);
    }

    if (body.action === 'records') {
      if (!SESSION.test(String(body.session ?? ''))) return json({ error: 'Enter your PIN again.' }, 401);
      const { data, error } = await db.rpc('card_records', { p_session: body.session });
      if (error) return json({ error: 'Could not load your record right now.' }, 500);
      if (!data) return json({ error: 'Your session ended. Enter your PIN again.' }, 401);
      data.profile.photo = await photoLink(data.profile.photo);
      return json(data);
    }

    if (body.action === 'lock') {
      if (SESSION.test(String(body.session ?? ''))) await db.rpc('card_lock', { p_session: body.session });
      return json({ ok: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: 'Something went wrong. Try again.' }, 500);
  }
});
