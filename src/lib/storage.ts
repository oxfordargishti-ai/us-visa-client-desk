import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

// Private object storage. Files are never public: they are only reachable through authenticated API routes
// (local driver streams the bytes, S3/R2 driver issues a 60-second signed URL after the ownership check).

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export interface StorageDriver {
  name: "local" | "s3";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** Short-lived direct URL, or null when the driver must stream the bytes itself. */
  signedUrl(key: string, filename: string, contentType: string, inline: boolean, ttlSeconds?: number): Promise<string | null>;
}

function safeLocalPath(root: string, key: string) {
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid storage key");
  return resolved;
}

const localDriver = (): StorageDriver => {
  const root = path.resolve(env.storage.localDir);
  return {
    name: "local",
    async put(key, body) {
      const p = safeLocalPath(root, key);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, body, { mode: 0o600 });
    },
    async get(key) {
      try {
        const body = await fs.readFile(safeLocalPath(root, key));
        return { body, contentType: "application/octet-stream" };
      } catch {
        return null;
      }
    },
    async delete(key) {
      await fs.rm(safeLocalPath(root, key), { force: true });
    },
    async signedUrl() {
      return null;
    },
  };
};

/** Turns a storage-provider error into a plain-language message (never includes keys). */
export function storageError(e: unknown): Error {
  const err = e as { name?: string; Code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const code = err.Code || err.name || "Error";
  const status = err.$metadata?.httpStatusCode;
  const hint =
    /InvalidAccessKeyId|SignatureDoesNotMatch|Unauthorized|InvalidArgument.*Credential/i.test(code + (err.message ?? "")) || status === 401
      ? "The storage keys don't match — re-copy S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (no spaces) and redeploy."
      : /AccessDenied/i.test(code) || status === 403
        ? "The storage key isn't allowed to write to this bucket — give the API token Object Read & Write on the bucket named in S3_BUCKET."
        : /NoSuchBucket/i.test(code) || status === 404
          ? "No bucket with the name in S3_BUCKET exists at that S3_ENDPOINT — check the spelling."
          : /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(err.message ?? "")
            ? "The storage address in S3_ENDPOINT can't be reached — check it."
            : "";
  const out = new Error(`Storage ${code}${status ? ` (${status})` : ""}: ${hint || (err.message ?? "").slice(0, 160)}`);
  out.name = "StorageError";
  return out;
}

const s3Driver = (): StorageDriver => {
  const cfg = env.storage;
  let clientP: Promise<import("@aws-sdk/client-s3").S3Client> | null = null;
  const client = () =>
    (clientP ??= import("@aws-sdk/client-s3").then(
      ({ S3Client }) =>
        new S3Client({
          region: cfg.region,
          endpoint: cfg.endpoint || undefined,
          forcePathStyle: Boolean(cfg.endpoint),
          credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
          // S3-compatible services (Cloudflare R2, Backblaze…) don't all accept the newer default checksum headers.
          ...(cfg.endpoint ? { requestChecksumCalculation: "WHEN_REQUIRED" as const, responseChecksumValidation: "WHEN_REQUIRED" as const } : {}),
        }),
    ));
  return {
    name: "s3",
    async put(key, body, contentType) {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      try {
        await (await client()).send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }));
      } catch (e) {
        throw storageError(e);
      }
    },
    async get(key) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      try {
        const r = await (await client()).send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        const bytes = await r.Body!.transformToByteArray();
        return { body: Buffer.from(bytes), contentType: r.ContentType || "application/octet-stream" };
      } catch {
        return null;
      }
    },
    async delete(key) {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      await (await client()).send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
    async signedUrl(key, filename, contentType, inline, ttl = 60) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const disp = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`;
      return getSignedUrl(await client(), new GetObjectCommand({ Bucket: cfg.bucket, Key: key, ResponseContentDisposition: disp, ResponseContentType: contentType }), { expiresIn: ttl });
    },
  };
};

export function getStorage(): StorageDriver {
  if (env.storage.driver === "s3") {
    if (!env.storage.bucket || !env.storage.accessKeyId || !env.storage.secretAccessKey) {
      const e = new Error("Storage is set to S3 but S3_BUCKET, S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY is missing — add it in the server settings and redeploy.");
      e.name = "StorageError";
      throw e;
    }
    return s3Driver();
  }
  if (env.isProd && !process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION) {
    throw new Error("Local file storage is not durable on serverless hosts. Configure S3-compatible storage (STORAGE_DRIVER=s3) — see README.");
  }
  return localDriver();
}

// ───────────── upload validation ─────────────
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const MAGIC: { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: "application/pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  { mime: "image/heic", test: (b) => b.subarray(4, 8).toString("latin1") === "ftyp" && /heic|heix|mif1|heif/.test(b.subarray(8, 12).toString("latin1")) },
  { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", test: (b) => b[0] === 0x50 && b[1] === 0x4b },
  { mime: "text/plain", test: (b) => !b.subarray(0, 512).includes(0) },
];
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heic",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain",
};

/** Decides the real content type from the file's bytes (never from the browser-supplied header) and rejects everything else. */
export function sniffUpload(filename: string, body: Buffer): { ok: true; mime: string } | { ok: false; error: string } {
  if (!body.length) return { ok: false, error: "That file is empty." };
  if (body.length > MAX_UPLOAD_BYTES) return { ok: false, error: "Files can be up to 15 MB." };
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const expected = EXT_MIME[ext];
  if (!expected) return { ok: false, error: "Supported files: PDF, JPG, PNG, WEBP, HEIC, DOCX, TXT." };
  const magic = MAGIC.find((m) => m.mime === expected);
  if (!magic || !magic.test(body)) return { ok: false, error: "The file contents don't match its extension." };
  return { ok: true, mime: expected };
}

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "file").slice(0, 150);
}
