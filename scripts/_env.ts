// Loads .env.local / .env for CLI scripts (Next.js does this itself for the web app).
import fs from "node:fs";

for (const f of [".env.local", ".env"]) {
  if (fs.existsSync(f)) {
    try {
      process.loadEnvFile(f);
    } catch {
      /* ignore malformed file */
    }
  }
}
