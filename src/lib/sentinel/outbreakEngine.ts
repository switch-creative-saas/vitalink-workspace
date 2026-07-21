import type { OutbreakCluster, SentinelCase, SentinelThresholds } from '@/types/sentinel';

const MS_DAY = 86400000;

function uniqueStates(cases: SentinelCase[]): string[] {
  return [...new Set(cases.map((c) => c.geo.state))];
}

function uniqueFacilities(cases: SentinelCase[]): string[] {
  return [...new Set(cases.map((c) => c.geo.facilityId))];
}

/** Rule-based outbreak detection — thresholds configurable per tenant */
export function evaluateOutbreakSignals(
  diseaseId: string,
  diseaseName: string,
  cases: SentinelCase[],
  thresholds: SentinelThresholds,
  now = Date.now(),
): OutbreakCluster | null {
  const relevant = cases.filter((c) => c.diseaseId === diseaseId && c.classification !== 'suspected');
  if (relevant.length < thresholds.minCasesForSignal) return null;

  const weekAgo = now - 7 * MS_DAY;
  const recent = relevant.filter((c) => new Date(c.reportedAt).getTime() >= weekAgo);
  const olderWindow = relevant.filter((c) => {
    const t = new Date(c.reportedAt).getTime();
    return t < weekAgo && t >= weekAgo - 7 * MS_DAY;
  });

  const growth = olderWindow.length === 0 ? 100 : ((recent.length - olderWindow.length) / Math.max(1, olderWindow.length)) * 100;
  const states = uniqueStates(recent);
  const facilities = uniqueFacilities(recent);

  const multiFacility = facilities.length >= thresholds.minFacilitiesInvolved;
  const rapidGrowth = growth >= thresholds.growthPctWeekly;
  const multiRegion = states.length >= 2;

  if (!rapidGrowth && !multiFacility && !multiRegion) return null;

  const status: OutbreakCluster['status'] =
    rapidGrowth && recent.length >= thresholds.minCasesForSignal + 2 ? 'active' : 'watch';

  return {
    id: `ob-${diseaseId}-${now}`,
    diseaseId,
    diseaseName,
    startedAt: new Date(now).toISOString(),
    status,
    affectedStates: states,
    caseCount: recent.length,
    facilityCount: facilities.length,
    recommendedActions: [
      multiFacility ? 'Activate facility liaison network and line-list validation.' : 'Increase community sensitization in presenting LGAs.',
      rapidGrowth ? 'Surge testing and activate emergency operations cadence.' : 'Maintain enhanced surveillance for 14 days.',
      'Prepare isolation pathways and pharmaceutical surge mapping via Pharmacy module.',
    ],
  };
}
