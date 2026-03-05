import sharp from "sharp";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const ICONS_SRC = join(ROOT, "client/public/app-icons");
const ICONS_OUT = join(ROOT, "client/public/generated-icons");

const APPS = [
  { key: "driver", svg: "icon-driver.svg" },
  { key: "clinic", svg: "icon-clinic.svg" },
  { key: "admin", svg: "icon-admin.svg" },
];

const SIZES = [
  { name: "AppIcon-1024.png", size: 1024 },
  { name: "AppIcon-512.png", size: 512 },
  { name: "icon-192.png", size: 192 },
];

async function generate() {
  for (const app of APPS) {
    const svgPath = join(ICONS_SRC, app.key, app.svg);
    if (!existsSync(svgPath)) {
      console.error(`[SKIP] SVG not found: ${svgPath}`);
      continue;
    }
    const svgBuffer = readFileSync(svgPath);
    const outDir = join(ICONS_OUT, app.key);
    mkdirSync(outDir, { recursive: true });

    for (const s of SIZES) {
      const outPath = join(outDir, s.name);
      await sharp(svgBuffer)
        .resize(s.size, s.size)
        .png()
        .toFile(outPath);
      console.log(`[OK] ${app.key}/${s.name} (${s.size}x${s.size})`);
    }
  }
  console.log("\nAll icons generated in client/public/generated-icons/");
}

generate().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
