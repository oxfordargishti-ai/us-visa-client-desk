// Central, lazy environment access. Nothing here is ever imported into client components.

const isProd = () => process.env.NODE_ENV === "production";

export const env = {
  get isProd() {
    return isProd();
  },
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get databaseUrl() {
    return process.env.DATABASE_URL || "";
  },
  get pgliteDir() {
    return process.env.PGLITE_DIR || ""; // "" → in-memory (tests) or .data/pglite (dev)
  },
  get encryptionKey() {
    return process.env.ENCRYPTION_KEY || "";
  },
  get cronSecret() {
    return process.env.CRON_SECRET || "";
  },
  get anthropicKey() {
    return process.env.ANTHROPIC_API_KEY || "";
  },
  get anthropicModel() {
    return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  },
  get vapidPublic() {
    return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || "";
  },
  get vapidPrivate() {
    return process.env.VAPID_PRIVATE_KEY || "";
  },
  get vapidSubject() {
    return process.env.VAPID_SUBJECT || "mailto:info@usvisawithargishti.com";
  },
  get googleClientId() {
    return process.env.GOOGLE_CLIENT_ID || "";
  },
  get googleClientSecret() {
    return process.env.GOOGLE_CLIENT_SECRET || "";
  },
  get googleLoginEnabled() {
    return process.env.GOOGLE_LOGIN_ENABLED === "true";
  },
  get smtp() {
    return {
      host: process.env.SMTP_HOST || "",
      port: Number(process.env.SMTP_PORT || 587),
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
      from: process.env.SMTP_FROM || "US VISA WITH ARGISHTI <info@usvisawithargishti.com>",
      secure: process.env.SMTP_SECURE === "true",
    };
  },
  get storage() {
    return {
      driver: (process.env.STORAGE_DRIVER || "local") as "local" | "s3",
      localDir: process.env.STORAGE_LOCAL_DIR || "./storage-local",
      bucket: process.env.S3_BUCKET || "",
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT || "",
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    };
  },
  get ownerEmail() {
    return process.env.OWNER_EMAIL || "";
  },
  get ownerPassword() {
    return process.env.OWNER_INITIAL_PASSWORD || "";
  },
  get ownerName() {
    return process.env.OWNER_NAME || "Argishti";
  },
};

export const capabilities = () => ({
  ai: Boolean(env.anthropicKey),
  push: Boolean(env.vapidPublic && env.vapidPrivate),
  email: Boolean(env.smtp.host),
  google: Boolean(env.googleClientId && env.googleClientSecret),
  googleLogin: env.googleLoginEnabled && Boolean(env.googleClientId && env.googleClientSecret),
  storage: env.storage.driver,
});
