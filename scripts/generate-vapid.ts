import webpush from "web-push";
import crypto from "node:crypto";

const v = webpush.generateVAPIDKeys();
console.log("# Paste these into your hosting provider's environment variables (never commit them):\n");
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${v.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${v.privateKey}`);
console.log(`ENCRYPTION_KEY=${crypto.randomBytes(32).toString("base64")}`);
console.log(`CRON_SECRET=${crypto.randomBytes(24).toString("base64url")}`);
