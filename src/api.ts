import type { Category, Container, Dashboard, Location, Settings, Stock } from '../shared/model';
export type AppState = {
  demo: boolean;
  stocks: Stock[];
  settings: Settings;
  dashboard: Dashboard;
  locations: Location[];
  containers: Container[];
  setup: { water: boolean; buckets: boolean };
  integrations: { ai: boolean; email: boolean };
  deliveries: {
    id: string;
    subject: string;
    status: string;
    attempts: number;
    createdAt: string;
    sentAt: string | null;
    error: string | null;
  }[];
};
export async function api<T = unknown>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return response.json();
}
export async function download(url: string, filename: string, body?: unknown) {
  const response = await fetch(
    url,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  if (!response.ok) throw new Error((await response.json()).error || 'Download failed');
  const blob = await response.blob(),
    href = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 30000);
}
export const categoryNames: Record<Category, string> = {
  food: 'Food',
  water: 'Water',
  fuel: 'Fuel',
  dog: 'Dog',
  supplies: 'Supplies',
};
export const number = (n: number, digits = 0) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n);
export const dateLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${value}T00:00:00Z`))
    : 'Not recorded';
