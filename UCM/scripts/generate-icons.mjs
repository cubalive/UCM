import sharp from "sharp";
import { readFileSync, mkdirSync, existsSync, copyFileSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const ICONS_SRC = join(ROOT, "client/public/app-icons");
const ICONS_OUT = join(ROOT, "client/public/generated-icons");

const ALL_APPS = ["driver", "clinic", "admin"];
const MOBILE_DIRS = {
  driver: join(ROOT, "mobile-driver/resources"),
  clinic: join(ROOT, "mobile-clinic/resources"),
  admin: join(ROOT, "mobile-admin/resources"),
};

const SIZES = [
  { name: "icon-1024.png", size: 1024 },
  { name: "icon-512.png", size: 512 },
  { name: "icon-192.png", size: 192 },
];

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/generate-icons.mjs <driver|clinic|admin|all>");
  process.exit(1);
}

const apps = arg === "all" ? ALL_APPS : [arg];

for (const app of apps) {
  if (!ALL_APPS.includes(app)) {
    console.error(`Unknown app: ${app}. Must be one of: ${ALL_APPS.join(", ")}`);
    process.exit(1);
  }
}

async function generate() {
  for (const app of apps) {
    console.log(`\n=== Generating icons for: ${app} ===`);

    const svgPath = join(ICONS_SRC, app, "icon.svg");
    if (!existsSync(svgPath)) {
      console.error(`  [ERROR] SVG not found: ${svgPath}`);
      process.exit(1);
    }

    const svgBuffer = readFileSync(svgPath);
    const outDir = join(ICONS_OUT, app);
    mkdirSync(outDir, { recursive: true });

    for (const s of SIZES) {
      const outPath = join(outDir, s.name);
      await sharp(svgBuffer)
        .resize(s.size, s.size)
        .png()
        .toFile(outPath);
      console.log(`  [OK] ${s.name} (${s.size}x${s.size})`);
    }

    const mobileDir = MOBILE_DIRS[app];
    if (mobileDir) {
      mkdirSync(mobileDir, { recursive: true });
      const src1024 = join(outDir, "icon-1024.png");
      const dest1024 = join(mobileDir, "icon-1024.png");
      copyFileSync(src1024, dest1024);
      console.log(`  [OK] Copied icon-1024.png → ${dest1024}`);
    }

    const splashSvgPath = join(ICONS_SRC, app, "splash.svg");
    if (existsSync(splashSvgPath)) {
      const splashBuffer = readFileSync(splashSvgPath);
      const splashOut = join(outDir, "splash-2732.png");
      await sharp(splashBuffer)
        .resize(2732, 2732)
        .png()
        .toFile(splashOut);
      console.log(`  [OK] splash-2732.png (2732x2732)`);

      if (mobileDir) {
        const splashDir = join(mobileDir, "splash");
        mkdirSync(splashDir, { recursive: true });
        copyFileSync(splashOut, join(splashDir, "splash-2732.png"));
        console.log(`  [OK] Copied splash-2732.png → mobile resources`);
      }
    }

    console.log(`=== ${app} COMPLETE ===`);
  }

  console.log("\nAll icons generated successfully.");
}

generate().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
