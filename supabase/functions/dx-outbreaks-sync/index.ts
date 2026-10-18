// Daily sync of WHO Disease Outbreak News for Nigeria into dx_outbreak_signals,
// so VitaMind Dx raises the matching condition nationally while it is current.
// Run by pg_cron; takes no input and only ever reads WHO's public feed.
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const WHO_DON = 'https://www.who.int/api/news/diseaseoutbreaknews';
const RECENT_DAYS = 120;  // older posts are not treated as current
const SIGNAL_DAYS = 60;   // a WHO post raises the condition for 60 days

type Don = { Title: string; PublicationDate: string; DonId: string | null; UrlName: string };
type Condition = { id: string; name: string; aliases: string[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchConditions(disease: string, conditions: Condition[]): string[] {
  const text = disease.toLowerCase();
  return conditions
    .filter((c) => [c.name, ...c.aliases].some((term) => term.length > 3 && new RegExp(`\\b${escape(term.toLowerCase())}\\b`).test(text)))
    .map((c) => c.id);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const params = new URLSearchParams({
    $filter: "contains(Title,'Nigeria')",
    $orderby: 'PublicationDate desc',
    $top: '20',
    $select: 'Title,PublicationDate,DonId,UrlName',
  });
  const res = await fetch(`${WHO_DON}?${params}`);
  if (!res.ok) return json({ error: `WHO feed failed (${res.status})` }, 502);
  const items = ((await res.json()).value ?? []) as Don[];

  const { data: conditions, error } = await admin.from('dx_conditions').select('id, name, aliases');
  if (error) return json({ error: error.message }, 500);

  const now = Date.now();
  const thisYear = new Date().getUTCFullYear();
  let added = 0;
  for (const item of items) {
    const published = new Date(item.PublicationDate);
    // WHO re-publishes archive items with new dates, so the DON id's year must be recent too.
    const donYear = Number((item.DonId ?? item.UrlName).match(/^(\d{4})/)?.[1] ?? 0);
    if (now - published.getTime() > RECENT_DAYS * 86400000 || donYear < thisYear - 1) continue;
    const disease = item.Title.split(/\s[-–]\s|-(?=\s*Nigeria)/)[0];
    const ids = matchConditions(disease, (conditions ?? []) as Condition[]);
    const url = `https://www.who.int/emergencies/disease-outbreak-news/item/${item.DonId ?? item.UrlName}`;
    const startsOn = published.toISOString().slice(0, 10);
    const endsOn = new Date(published.getTime() + SIGNAL_DAYS * 86400000).toISOString().slice(0, 10);
    for (const conditionId of ids) {
      const { error: upsertError, count } = await admin.from('dx_outbreak_signals').upsert({
        condition_id: conditionId, state: null, level: 'active', source: 'who', title: item.Title, source_url: url,
        note: 'WHO Disease Outbreak News', starts_on: startsOn, ends_on: endsOn, external_id: item.DonId ?? item.UrlName,
      }, { onConflict: 'source,external_id,condition_id', ignoreDuplicates: true, count: 'exact' });
      if (!upsertError) added += count ?? 0;
    }
  }
  return json({ checked: items.length, added });
});
