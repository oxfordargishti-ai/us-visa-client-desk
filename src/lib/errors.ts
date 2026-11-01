import { z } from "zod";

// Framework-free so repositories and tests can import it without pulling in Next.js.
export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error", public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, details?: unknown) => new HttpError(400, m, "bad_request", details);
export const notFound = (what = "Not found") => new HttpError(404, what, "not_found");
export const conflict = (m: string) => new HttpError(409, m, "conflict");

export const zId = z.guid();
export const zIso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date/time");
