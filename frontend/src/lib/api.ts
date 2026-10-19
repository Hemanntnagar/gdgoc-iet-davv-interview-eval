import { API_URL } from './config';

export { API_URL };

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(`${API_URL}/api${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = body?.error ?? body ?? {};
    throw new ApiError(
      res.status,
      err.code ?? 'error',
      err.message ?? `Request failed (${res.status})`,
      err.details,
    );
  }
  return body as T;
}

/** Raw URL for CSV downloads (opened in a new tab / anchor). */
export function csvUrl(path: string, token: string): string {
  // Token must be attached via fetch for security; for simplicity we create a
  // blob download helper instead.
  void token;
  return `${API_URL}/api${path}`;
}

export async function downloadCsv(path: string, token: string, filename: string): Promise<void> {
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
