"use client";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** Small fetch wrapper: JSON in/out, readable errors, and a redirect to /login when the session has ended. */
export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const d = data as { error?: string; code?: string } | null;
    if (res.status === 401 && !url.startsWith("/api/auth/login")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    throw new ApiError(res.status, d?.error ?? "Something went wrong. Please try again.", d?.code);
  }
  return data as T;
}

export async function upload<T = unknown>(url: string, form: FormData, maxMb = 15): Promise<T> {
  for (const v of form.values()) {
    if (v instanceof File && v.size > maxMb * 1024 * 1024) {
      throw new ApiError(413, `${v.name} is ${(v.size / 1048576).toFixed(1)} MB — the limit is ${maxMb} MB. Compress it or split the PDF and try again.`, "too_large");
    }
  }
  const res = await fetch(url, { method: "POST", body: form, credentials: "same-origin" });
  if (res.status === 413) throw new ApiError(413, `That file is too large — the limit is ${maxMb} MB. Compress it or split the PDF and try again.`, "too_large");
  const data = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Upload failed. Please try again.", data?.code);
  return data as T;
}
