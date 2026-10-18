import { useEffect, useState } from 'react';
import { BookOpen, ExternalLink, RefreshCw } from 'lucide-react';
import { getLiterature, type DxArticle } from '@/lib/supabase/diagnosis';

// Recent reviews and guidelines from PubMed for one condition.
export function LiteraturePanel({ conditionId, conditionName }: { conditionId: string; conditionName: string }) {
  const [state, setState] = useState<{ loading: boolean; articles: DxArticle[]; total: number; fetchedAt?: string; error?: string; stale?: boolean }>({ loading: true, articles: [], total: 0 });

  const load = (refresh: boolean) => {
    setState((s) => ({ ...s, loading: true, error: undefined }));
    getLiterature(conditionId, refresh)
      .then((r) => setState({ loading: false, articles: r.articles, total: r.total, fetchedAt: r.fetchedAt, stale: r.stale }))
      .catch((error) => setState({ loading: false, articles: [], total: 0, error: error instanceof Error ? error.message : 'Could not reach PubMed.' }));
  };
  useEffect(() => {
    let cancelled = false;
    getLiterature(conditionId)
      .then((r) => { if (!cancelled) setState({ loading: false, articles: r.articles, total: r.total, fetchedAt: r.fetchedAt, stale: r.stale }); })
      .catch((error) => { if (!cancelled) setState({ loading: false, articles: [], total: 0, error: error instanceof Error ? error.message : 'Could not reach PubMed.' }); });
    return () => { cancelled = true; };
  }, [conditionId]);

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-700"><BookOpen className="h-3.5 w-3.5" />Research on {conditionName} (PubMed + Europe PMC)</p>
        <button className="flex items-center gap-1 text-xs text-royal-600 hover:underline disabled:opacity-50" disabled={state.loading} onClick={() => load(true)}>
          <RefreshCw className={state.loading ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />Refresh
        </button>
      </div>
      {state.loading && state.articles.length === 0 ? <p className="text-xs text-gray-500">Searching PubMed and Europe PMC…</p>
        : state.error ? <p className="text-xs text-red-600">{state.error}</p>
        : state.articles.length === 0 ? <p className="text-xs text-gray-500">No recent papers found.</p> : (
          <ul className="space-y-2">
            {state.articles.map((a) => (
              <li key={a.pmid} className="text-xs">
                <a href={a.url} target="_blank" rel="noreferrer" className="font-medium text-gray-900 hover:text-royal-700 hover:underline">
                  {a.title}<ExternalLink className="ml-1 inline h-3 w-3 text-gray-400" />
                </a>
                <p className="text-gray-500">
                  {[a.authors, a.journal, a.year].filter(Boolean).join(' · ')}{a.types.some((t) => /guideline/i.test(t)) ? ' · Guideline' : a.types.some((t) => /review|meta/i.test(t)) ? ' · Review' : ''}
                  {a.source && <span className="ml-1.5 rounded bg-white px-1 text-[10px] text-gray-500 ring-1 ring-gray-200">{a.source}</span>}
                  {a.openAccess && <span className="ml-1 rounded bg-green-50 px-1 text-[10px] text-green-700 ring-1 ring-green-200">Open access</span>}
                  {a.local && <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-700 ring-1 ring-amber-200">Africa</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      {state.fetchedAt && (
        <p className="mt-2 text-[11px] text-gray-400">
          {state.total.toLocaleString()} matching papers · checked {new Date(state.fetchedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{state.stale ? ' (sources unreachable, showing saved results)' : ''}
        </p>
      )}
    </div>
  );
}
