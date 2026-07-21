/**
 * useSentinelTheme Hook
 * Detects current theme mode and provides theme-aware class names
 * for the VitaLink Sentinel dashboard components
 */

import { useEffect, useState, useMemo } from 'react';

export type SentinelThemeMode = 'light' | 'dark';

export interface SentinelThemeClasses {
  // Container
  page: string;
  card: string;
  cardElevated: string;
  glass: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  // Backgrounds
  bgMain: string;
  bgSurface: string;
  bgElevated: string;

  // Borders
  border: string;
  borderStrong: string;

  // Interactive
  buttonPrimary: string;
  buttonSecondary: string;
  buttonOutline: string;
  buttonGhost: string;

  // Status
  badgeGreen: string;
  badgeAmber: string;
  badgeBlue: string;
  badgeRed: string;

  // Metric cards
  metric: string;
  metricGreen: string;
  metricYellow: string;
  metricRed: string;
  metricLabel: string;
  metricValue: string;
  metricSub: string;

  // Table
  table: string;
  tableHeader: string;
  tableCell: string;

  // Tabs
  tabs: string;
  tab: string;
  tabActive: string;

  // Hero
  hero: string;
  heroContent: string;

  // Charts
  chartGrid: string;
  chartTooltip: string;
  chartAxis: string;
}

export interface UseSentinelThemeReturn {
  isDark: boolean;
  mode: SentinelThemeMode;
  classes: SentinelThemeClasses;
}

function getThemeMode(): SentinelThemeMode {
  if (typeof document === 'undefined') return 'light';
  const root = document.documentElement;
  return root.classList.contains('dark-theme') ? 'dark' : 'light';
}

export function useSentinelTheme(): UseSentinelThemeReturn {
  const [mode, setMode] = useState<SentinelThemeMode>(getThemeMode());

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setMode(getThemeMode());
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    // Also listen for storage changes (theme toggle)
    const handleStorage = () => {
      setMode(getThemeMode());
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      observer.disconnect();
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const isDark = mode === 'dark';

  const classes = useMemo<SentinelThemeClasses>(() => {
    // Chart colors based on mode (for Recharts)
    const chartColors = {
      grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)',
      axis: isDark ? '#94A3B8' : '#64748B',
      tooltipBg: isDark ? '#162033' : '#FFFFFF',
      tooltipBorder: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.12)',
    };

    return {
      // Container
      page: 'sentinel-page',
      card: 'sentinel-card',
      cardElevated: 'sentinel-card sentinel-card-elevated',
      glass: 'sentinel-glass',

      // Text
      textPrimary: 'sentinel-text-primary',
      textSecondary: 'sentinel-text-secondary',
      textMuted: 'sentinel-text-muted',

      // Backgrounds
      bgMain: 'bg-[var(--sentinel-bg-main)]',
      bgSurface: 'bg-[var(--sentinel-bg-surface)]',
      bgElevated: 'bg-[var(--sentinel-bg-elevated)]',

      // Borders
      border: 'border border-[var(--sentinel-border-default)]',
      borderStrong: 'border border-[var(--sentinel-border-strong)]',

      // Interactive
      buttonPrimary: 'sentinel-btn sentinel-btn-primary',
      buttonSecondary: 'sentinel-btn sentinel-btn-secondary',
      buttonOutline: 'sentinel-btn sentinel-btn-outline',
      buttonGhost: 'sentinel-btn sentinel-btn-ghost',

      // Status
      badgeGreen: 'sentinel-badge sentinel-badge-green',
      badgeAmber: 'sentinel-badge sentinel-badge-amber',
      badgeBlue: 'sentinel-badge sentinel-badge-blue',
      badgeRed: 'sentinel-badge sentinel-badge-red',

      // Metric cards
      metric: 'sentinel-metric',
      metricGreen: 'sentinel-metric sentinel-metric-green',
      metricYellow: 'sentinel-metric sentinel-metric-yellow',
      metricRed: 'sentinel-metric sentinel-metric-red',
      metricLabel: 'sentinel-metric-label',
      metricValue: 'sentinel-metric-value',
      metricSub: 'sentinel-metric-sub',

      // Table
      table: 'sentinel-table',
      tableHeader: 'sentinel-table-header',
      tableCell: 'sentinel-table-cell',

      // Tabs
      tabs: 'sentinel-tabs',
      tab: 'sentinel-tab',
      tabActive: 'sentinel-tab sentinel-tab-active',

      // Hero
      hero: 'sentinel-hero',
      heroContent: 'sentinel-hero-content',

      // Charts (values for Recharts props)
      chartGrid: chartColors.grid,
      chartTooltip: chartColors.tooltipBg,
      chartAxis: chartColors.axis,
    };
  }, [isDark]);

  return {
    isDark,
    mode,
    classes,
  };
}

/**
 * Helper to get chart colors for Recharts components
 */
export function getSentinelChartColors(isDark: boolean) {
  return {
    grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)',
    axis: isDark ? '#94A3B8' : '#64748B',
    tooltipBg: isDark ? '#162033' : '#FFFFFF',
    tooltipBorder: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.12)',
    tooltipText: isDark ? '#F8FAFC' : '#0F172A',
    purple: isDark ? '#A78BFA' : '#8B5CF6',
    pink: isDark ? '#F472B6' : '#EC4899',
    blue: isDark ? '#60A5FA' : '#3B82F6',
    cyan: isDark ? '#22D3EE' : '#06B6D4',
    green: isDark ? '#34D399' : '#10B981',
    amber: isDark ? '#FBBF24' : '#F59E0B',
    red: isDark ? '#F87171' : '#EF4444',
  };
}

/**
 * Helper to get metric card tone colors
 */
export function getMetricTone(tone: 'green' | 'yellow' | 'red' | undefined, isDark: boolean) {
  const colors = {
    green: isDark
      ? { border: '#34D399', shadow: 'rgba(52,211,153,0.12)' }
      : { border: '#10B981', shadow: 'rgba(16,185,129,0.08)' },
    yellow: isDark
      ? { border: '#FBBF24', shadow: 'rgba(251,191,36,0.12)' }
      : { border: '#F59E0B', shadow: 'rgba(245,158,11,0.08)' },
    red: isDark
      ? { border: '#F87171', shadow: 'rgba(248,113,113,0.12)' }
      : { border: '#EF4444', shadow: 'rgba(239,68,68,0.08)' },
  };

  if (!tone) return null;
  return colors[tone];
}
