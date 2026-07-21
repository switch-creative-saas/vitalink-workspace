import { useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import { cn } from '@/lib/utils';
import { useSentinelTheme } from '@/hooks/useSentinelTheme';
import type { SentinelCase } from '@/types/sentinel';

const DEFAULT_CENTER: [number, number] = [9.082, 8.6753]; // Nigeria centroid

export interface SentinelMapPanelProps {
  cases: SentinelCase[];
  layerMode: 'cases' | 'facilities' | 'labs' | 'vax' | 'outbreak';
}

export function SentinelMapPanel({ cases, layerMode }: SentinelMapPanelProps) {
  const { classes, isDark } = useSentinelTheme();

  const markers = useMemo(() => {
    return cases
      .filter((c) => c.geo.coordinates)
      .map((c) => ({
        id: c.id,
        pos: [c.geo.coordinates!.lat, c.geo.coordinates!.lng] as [number, number],
        label: `${c.diseaseName} · ${c.classification}`,
        severity: c.classification === 'confirmed' ? 'high' : c.classification === 'probable' ? 'mid' : 'low',
      }));
  }, [cases]);

  const color = (sev: string) =>
    sev === 'high'
      ? (isDark ? '#f87171' : '#ef4444')
      : sev === 'mid'
        ? (isDark ? '#fbbf24' : '#f59e0b')
        : (isDark ? '#34d399' : '#10b981');

  return (
    <div className={cn(
      'w-full max-w-full overflow-hidden rounded-2xl border backdrop-blur-xl',
      classes.border,
      isDark ? 'bg-slate-900/40' : 'bg-slate-50/80'
    )}>
      <div className="h-[min(420px,70vh)] w-full min-h-[280px]">
        <MapContainer center={DEFAULT_CENTER} zoom={6} className="h-full w-full z-0" scrollWheelZoom>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          {layerMode === 'cases' &&
            markers.map((m) => (
              <CircleMarker
                key={m.id}
                center={m.pos}
                radius={12}
                pathOptions={{
                  color: color(m.severity),
                  fillColor: color(m.severity),
                  fillOpacity: 0.4,
                  weight: 2,
                }}
              >
                <Tooltip
                  direction="top"
                  className={cn(
                    'rounded-lg border px-2 py-1 text-xs',
                    classes.border,
                    isDark ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'
                  )}
                >
                  {m.label}
                </Tooltip>
              </CircleMarker>
            ))}
          {layerMode !== 'cases' && (
            <CircleMarker
              center={[6.5244, 3.3792]}
              radius={14}
              pathOptions={{
                color: isDark ? '#818cf8' : '#4f46e5',
                fillColor: isDark ? '#818cf8' : '#4f46e5',
                fillOpacity: 0.3,
              }}
            >
              <Tooltip>Demo facility layer · integrate tenant registry</Tooltip>
            </CircleMarker>
          )}
        </MapContainer>
      </div>
      <p className={cn('text-[10px] px-3 py-2 border-t', classes.border, classes.textMuted)}>
        Mapbox-compatible structure · Leaflet OSM tiles · drill-down: Country → State → LGA → Facility (tenant-scoped).
      </p>
    </div>
  );
}
