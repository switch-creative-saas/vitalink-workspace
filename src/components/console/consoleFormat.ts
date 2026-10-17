// Formatting helpers shared by the console sections.
export const naira = (value: number) => `₦${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
