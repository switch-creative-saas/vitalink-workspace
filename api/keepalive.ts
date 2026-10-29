// Daily keep-alive for the Supabase project (run by Vercel Cron, see vercel.json). Supabase pauses
// Free-plan projects after 7 days without activity; one small read a day keeps it awake. It reads
// the public plan list with the public (publishable) key, so it touches no patient data.
// Not needed once the project is on a paid Supabase plan.
export async function GET(request: Request) {
  // Vercel Cron sends this header when CRON_SECRET is set in the project's environment variables.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ ok: false, error: 'Supabase URL or key is not set' }, { status: 500 });

  const started = Date.now();
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/plans?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return Response.json({ ok: res.ok, status: res.status, ms: Date.now() - started, at: new Date().toISOString() }, { status: res.ok ? 200 : 502 });
}
