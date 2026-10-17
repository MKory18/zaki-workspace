/** Thin typed fetch wrapper. Throws ApiError with code + details for UI handling. */
export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  messageKey?: string;
  constructor(code: string, status: number, details?: unknown, messageKey?: string) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
    this.messageKey = messageKey;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const headers: Record<string, string> | undefined = isForm
    ? undefined
    : { "content-type": "application/json", ...(init?.headers as Record<string, string> | undefined) };
  const res = await fetch(path, { ...init, headers });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string; details?: unknown };
    throw new ApiError(b.error ?? "internal", res.status, b.details, b.message);
  }
  return body as T;
}

export const apiGet = <T,>(path: string) => api<T>(path);
export const apiPost = <T,>(path: string, data?: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data ?? {}) });
export const apiPatch = <T,>(path: string, data?: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(data ?? {}) });
export const apiDelete = <T,>(path: string) => api<T>(path, { method: "DELETE" });

/** multipart upload — the browser sets the content-type boundary, not us. */
export const apiUpload = <T,>(path: string, form: FormData) =>
  api<T>(path, { method: "POST", body: form });

