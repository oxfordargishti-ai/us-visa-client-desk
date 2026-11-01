// Generates every brand asset from the owner's ORIGINAL logo file (assets/logo-original.png).
// The artwork and its typography are never redrawn — only cropped, padded and resized.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const SRC = "assets/logo-original.png";
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
mkdirSync("public/brand", { recursive: true });
mkdirSync("public/icons", { recursive: true });

// 1. Flatten onto white (the logo's native background) and crop the empty margins.
const flat = await sharp(SRC).flatten({ background: WHITE }).png().toBuffer();
const trimmed = await sharp(flat).trim({ threshold: 12 }).png().toBuffer();
const tm = await sharp(trimmed).metadata();
const PAD = 28;
const logoFull = await sharp(trimmed)
  .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: WHITE })
  .png()
  .toBuffer();
const lm = await sharp(logoFull).metadata();
console.log("logo (cropped, full-res):", lm.width, "x", lm.height, "(artwork", tm.width, "x", tm.height + ")");

await sharp(logoFull).toFile("public/brand/logo.png");
await sharp(logoFull).resize({ width: 640 }).png({ compressionLevel: 9 }).toFile("public/brand/logo-640.png");
await sharp(logoFull).resize({ width: 320 }).png({ compressionLevel: 9 }).toFile("public/brand/logo-320.png");

// 2. Square icons: the logo centred on white with a safe margin.
async function square(size, inner, out) {
  const art = await sharp(logoFull).resize({ width: inner, height: inner, fit: "inside", background: WHITE }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: art, gravity: "center" }])
    .flatten({ background: WHITE })
    .png({ compressionLevel: 9 })
    .toFile(out);
}
await square(192, Math.round(192 * 0.92), "public/icons/icon-192.png");
await square(512, Math.round(512 * 0.92), "public/icons/icon-512.png");
await square(512, Math.round(512 * 0.66), "public/icons/maskable-512.png"); // inside the 80% safe zone
await square(180, Math.round(180 * 0.92), "public/icons/apple-touch-icon.png");
await square(512, Math.round(512 * 0.92), "src/app/icon.png");
await square(180, Math.round(180 * 0.92), "src/app/apple-icon.png");

// 3. favicon.ico (PNG-embedded ICO with 16/32/48).
const sizes = [16, 32, 48];
const pngs = [];
for (const s of sizes) {
  const b = await sharp(logoFull).resize({ width: s, height: s, fit: "contain", background: WHITE }).flatten({ background: WHITE }).ensureAlpha().png().toBuffer(); // ICO PNGs must be RGBA
  pngs.push(b);
}
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = pngs.map((b, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(sizes[i], 0); e.writeUInt8(sizes[i], 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(b.length, 8); e.writeUInt32LE(offset, 12);
  offset += b.length;
  return e;
});
writeFileSync("src/app/favicon.ico", Buffer.concat([header, ...entries, ...pngs]));

// 4. Monochrome badge for Android notification bar: any non-white pixel of the artwork becomes white on transparent.
const { data, info } = await sharp(logoFull).resize({ width: 96, height: 96, fit: "contain", background: WHITE }).flatten({ background: WHITE }).raw().toBuffer({ resolveWithObject: true });
const out = Buffer.alloc(info.width * info.height * 4);
for (let i = 0; i < info.width * info.height; i++) {
  const r = data[i * info.channels], g = data[i * info.channels + 1], b = data[i * info.channels + 2];
  const lum = (r + g + b) / 3;
  const alpha = Math.max(0, Math.min(255, Math.round((255 - lum) * 1.4)));
  out[i * 4] = 255; out[i * 4 + 1] = 255; out[i * 4 + 2] = 255; out[i * 4 + 3] = alpha;
}
await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile("public/icons/badge-96.png");

console.log("brand assets written");
