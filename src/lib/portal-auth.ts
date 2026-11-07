// Who is calling from the client portal? The portal (portal.usvisawithargishti.com) signs clients in with Google through
// Wix Members and sends that member's Wix access token. We never trust what the browser says about itself: the token is
// checked with Wix, and the application id must be a record that member owns in the ClientApplications collection.
import { HttpError } from "./errors";
import { paynetConfig } from "./paynet";

export interface PortalMember {
  memberId: string;
  email: string; // Google-verified login email, lower-case
}

const unauthorized = () => new HttpError(401, "Please sign in again.", "unauthorized");

/** "Authorization: Bearer <wix access token>" (or the bare token, as Wix itself accepts). */
export function bearerToken(req: Request): string | null {
  const h = (req.headers.get("authorization") || "").trim();
  if (!h) return null;
  const t = h.replace(/^Bearer\s+/i, "").trim();
  return t.length >= 20 && t.length <= 8192 && !/\s/.test(t) ? t : null;
}

async function wix<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T | null }> {
  let res: Response;
  try {
    res = await fetch(`${paynetConfig.wixApiBase}${path}`, {
      method: init.method || "GET",
      headers: { Authorization: token, Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, "The client portal's sign-in service could not be reached. Please try again.", "wix_unreachable");
  }
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    /* no body */
  }
  return { status: res.status, data };
}

/** Confirms the token belongs to a signed-in Wix member and returns who it is. */
export async function verifyPortalMember(token: string | null): Promise<PortalMember> {
  if (!token) throw unauthorized();
  const r = await wix<{ member?: { id?: string; loginEmail?: string; status?: string } }>(token, "/members/v1/members/my?fieldsets=FULL");
  if (r.status === 401 || r.status === 403 || r.status === 404) throw unauthorized();
  if (r.status >= 400) throw new HttpError(502, "The client portal's sign-in service is not answering. Please try again.", "wix_error");
  const m = r.data?.member;
  const email = (m?.loginEmail || "").trim().toLowerCase();
  if (!m?.id || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw unauthorized();
  if (m.status && ["PENDING", "BLOCKED"].includes(m.status)) throw unauthorized();
  return { memberId: m.id, email };
}

/**
 * Confirms the application record belongs to this member. Wix only returns a ClientApplications item to the member who
 * created it (collection permission: "site member author"), and we also compare its _owner.
 */
export async function assertApplicationOwner(token: string, applicationId: string, member: PortalMember): Promise<void> {
  const body = { dataCollectionId: paynetConfig.wixCollection, query: { filter: { _id: { $eq: applicationId } }, paging: { limit: 1 } } };
  const r = await wix<{ dataItems?: { id?: string; data?: { _id?: string; _owner?: string } }[] }>(token, "/wix-data/v2/items/query", { method: "POST", body });
  if (r.status === 401 || r.status === 403) throw unauthorized();
  if (r.status >= 400) throw new HttpError(502, "Your application could not be checked. Please try again.", "wix_error");
  const item = r.data?.dataItems?.[0];
  const id = item?.id || item?.data?._id;
  const owner = item?.data?._owner;
  if (!item || id !== applicationId || (owner && owner !== member.memberId)) {
    throw new HttpError(404, "Application not found for this account.", "not_found");
  }
}

/** Wix data item ids (GUIDs in practice); kept to characters that are safe inside Paynet's order_id. */
export const APPLICATION_ID = /^[A-Za-z0-9_-]{8,64}$/;
