// Research sourcing for VitaMind Dx: finds recent reviews and guidelines for a
// condition on PubMed (NCBI E-utilities) and Europe PMC (which adds full-text,
// open-access papers, preprints and guideline bodies such as WHO), merges them
// with African/Nigerian work first, and caches the list in dx_literature for
// 7 days. Both are free public literature databases, not AI models.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const EVIDENCE = '(review[pt] OR systematic review[pt] OR meta-analysis[pt] OR guideline[pt] OR practice guideline[pt])';

type Article = {
  pmid: string; title: string; journal: string; year: string; authors: string; types: string[]; doi: string | null; url: string;
  source: 'PubMed' | 'Europe PMC'; openAccess?: boolean; local?: boolean;
};

const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const LOCAL = /nigeria|africa|ghana|kenya|uganda|tanzania|malawi|cameroon|sahara/i;

function params(extra: Record<string, string>) {
  const p = new URLSearchParams({ db: 'pubmed', retmode: 'json', tool: 'VitaLink', ...extra });
  const key = Deno.env.get('NCBI_API_KEY');
  const email = Deno.env.get('NCBI_EMAIL');
  if (key) p.set('api_key', key);
  if (email) p.set('email', email);
  return p;
}

async function search(term: string): Promise<{ ids: string[]; total: number }> {
  const res = await fetch(`${EUTILS}/esearch.fcgi?${params({ term, retmax: '8', sort: 'relevance' })}`);
  if (!res.ok) throw new Error(`PubMed search failed (${res.status})`);
  const body = await res.json();
  return { ids: body.esearchresult?.idlist ?? [], total: Number(body.esearchresult?.count ?? 0) };
}

async function summaries(ids: string[]): Promise<Article[]> {
  if (!ids.length) return [];
  const res = await fetch(`${EUTILS}/esummary.fcgi?${params({ id: ids.join(',') })}`);
  if (!res.ok) throw new Error(`PubMed summary failed (${res.status})`);
  const body = await res.json();
  return ids.map((id) => body.result?.[id]).filter(Boolean).map((r: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const authors = (r.authors ?? []).map((a: { name: string }) => a.name);
    const doi = (r.articleids ?? []).find((a: { idtype: string }) => a.idtype === 'doi')?.value ?? null;
    return {
      pmid: String(r.uid),
      title: String(r.title ?? '').replace(/<[^>]+>/g, '').trim(),
      journal: String(r.fulljournalname || r.source || ''),
      year: String(r.pubdate ?? '').slice(0, 4),
      authors: authors.length > 3 ? `${authors.slice(0, 3).join(', ')} et al.` : authors.join(', '),
      types: (r.pubtype ?? []) as string[],
      doi,
      url: `https://pubmed.ncbi.nlm.nih.gov/${r.uid}/`,
      source: 'PubMed' as const,
    };
  });
}

// Europe PMC takes free text, so PubMed field tags like [MeSH] are dropped.
async function europePmc(pubmedQuery: string, sinceYear: number): Promise<{ articles: Article[]; total: number }> {
  const base = pubmedQuery.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
  const query = `(${base}) AND (PUB_TYPE:"review" OR PUB_TYPE:"practice guideline" OR PUB_TYPE:"guideline" OR PUB_TYPE:"systematic-review") AND FIRST_PDATE:[${sinceYear}-01-01 TO 3000-12-31]`;
  const res = await fetch(`${EPMC}?${new URLSearchParams({ query, format: 'json', pageSize: '8', resultType: 'lite' })}`); // default order is relevance
  if (!res.ok) throw new Error(`Europe PMC search failed (${res.status})`);
  const body = await res.json();
  const rows = (body.resultList?.result ?? []) as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    total: Number(body.hitCount ?? 0),
    articles: rows.map((r) => ({
      pmid: String(r.pmid ?? r.id),
      title: String(r.title ?? '').replace(/<[^>]+>/g, '').trim(),
      journal: String(r.journalTitle ?? r.bookOrReportDetails?.publisher ?? ''),
      year: String(r.pubYear ?? ''),
      authors: String(r.authorString ?? '').split(', ').length > 3 ? `${String(r.authorString).split(', ').slice(0, 3).join(', ')} et al.` : String(r.authorString ?? '').replace(/\.$/, ''),
      types: String(r.pubType ?? '').split(';').map((t) => t.trim()).filter(Boolean),
      doi: r.doi ? String(r.doi) : null,
      url: r.pmcid ? `https://europepmc.org/article/PMC/${r.pmcid}` : `https://europepmc.org/article/${r.source}/${r.id}`,
      source: 'Europe PMC' as const,
      openAccess: r.isOpenAccess === 'Y',
    })),
  };
}

// One list: the two sources interleaved in relevance order, duplicates removed
// (same PMID or DOI); African/Nigerian papers that are about the condition go first.
function merge(lists: Article[][], terms: string[]): Article[] {
  const seen = new Set<string>();
  const out: Article[] = [];
  const interleaved = Array.from({ length: Math.max(...lists.map((l) => l.length), 0) }, (_, i) => lists.map((l) => l[i])).flat().filter(Boolean) as Article[];
  const onTopic = (title: string) => terms.some((t) => title.toLowerCase().includes(t));
  for (const a of interleaved) {
    const keys = [a.pmid && `p:${a.pmid}`, a.doi && `d:${a.doi.toLowerCase()}`].filter(Boolean) as string[];
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push({ ...a, local: LOCAL.test(`${a.title} ${a.journal}`) && onTopic(a.title) });
  }
  return out.sort((x, y) => Number(y.local) - Number(x.local)).slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'Sign in first.' }, 401);

  const { conditionId, refresh } = await req.json().catch(() => ({}));
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: condition } = await admin.from('dx_conditions').select('id, name, pubmed_query, aliases').eq('id', String(conditionId)).maybeSingle();
  if (!condition) return json({ error: 'Unknown condition.' }, 404);

  const { data: cached } = await admin.from('dx_literature').select('*').eq('condition_id', condition.id).maybeSingle();
  if (cached && !refresh && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_MS) {
    return json({ articles: cached.articles, total: cached.total, query: cached.query, fetchedAt: cached.fetched_at, cached: true });
  }

  try {
    const sinceYear = new Date().getFullYear() - 10;
    const since = `("${sinceYear}"[dp] : "3000"[dp])`;
    let query = `(${condition.pubmed_query}) AND ${EVIDENCE} AND ${since}`;
    // Either source can fail on its own; the other still answers.
    const [pubmed, epmc] = await Promise.allSettled([
      (async () => {
        let found = await search(query);
        if (found.ids.length < 3) {
          // Not enough reviews or guidelines: fall back to any recent paper.
          query = `(${condition.pubmed_query}) AND ${since}`;
          found = await search(query);
        }
        return { articles: await summaries(found.ids), total: found.total };
      })(),
      europePmc(condition.pubmed_query, sinceYear),
    ]);
    if (pubmed.status === 'rejected' && epmc.status === 'rejected') throw pubmed.reason;
    const terms = [condition.name.replace(/\(.*?\)/g, ''), ...(condition.aliases ?? [])]
      .map((t: string) => t.toLowerCase().trim()).filter((t: string) => t.length > 3);
    const articles = merge([
      pubmed.status === 'fulfilled' ? pubmed.value.articles : [],
      epmc.status === 'fulfilled' ? epmc.value.articles : [],
    ], terms);
    const found = { total: (pubmed.status === 'fulfilled' ? pubmed.value.total : 0) + (epmc.status === 'fulfilled' ? epmc.value.total : 0) };
    const fetchedAt = new Date().toISOString();
    await admin.from('dx_literature').upsert({ condition_id: condition.id, query, articles, total: found.total, fetched_at: fetchedAt });
    return json({ articles, total: found.total, query, fetchedAt, cached: false });
  } catch (error) {
    // PubMed unreachable: serve whatever was cached before, however old.
    if (cached) return json({ articles: cached.articles, total: cached.total, query: cached.query, fetchedAt: cached.fetched_at, cached: true, stale: true });
    return json({ error: error instanceof Error ? error.message : 'PubMed is unavailable right now.' }, 502);
  }
});
