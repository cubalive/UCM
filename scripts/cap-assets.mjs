import sharp from "sharp";
import { readFileSync, mkdirSync, existsSync, copyFileSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const ICONS_SRC = join(ROOT, "client/public/app-icons");
const ICONS_OUT = join(ROOT, "client/public/generated-icons");

const MOBILE_DIRS = {
  driver: join(ROOT, "mobile-driver"),
  clinic: join(ROOT, "mobile-clinic"),
  admin: join(ROOT, "mobile-admin"),
};

const appKey = process.argv[2];
if (!appKey || !["driver", "clinic", "admin"].includes(appKey)) {
  console.error("Usage: node scripts/cap-assets.mjs <driver|clinic|admin>");
  process.exit(1);
}

const srcDir = join(ICONS_SRC, appKey);
const outDir = join(ICONS_OUT, appKey);
const mobileDir = MOBILE_DIRS[appKey];
const resourcesDir = join(mobileDir, "resources");

async function renderSvg(svgName, size) {
  const svgPath = join(srcDir, svgName);
  if (!existsSync(svgPath)) {
    throw new Error(`SVG not found: ${svgPath}`);
  }
  const svgBuffer = readFileSync(svgPath);
  return sharp(svgBuffer).resize(size, size).png().toBuffer();
}

async function writeIcon(buffer, dir, filename) {
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, filename);
  await sharp(buffer).toFile(outPath);
  console.log(`  [OK] ${filename}`);
  return outPath;
}

async function generate() {
  console.log(`\n=== Generating assets for: ${appKey} ===`);
  console.log(`  Source: ${srcDir}`);
  console.log(`  Output: ${outDir}`);
  console.log(`  Mobile: ${resourcesDir}\n`);

  const svgFiles = [
    "icon-foreground.svg",
    "icon-background.svg",
    "icon-monochrome.svg",
    "icon-maskable.svg",
  ];
  for (const f of svgFiles) {
    if (!existsSync(join(srcDir, f))) {
      console.error(`  [MISSING] ${f} — aborting`);
      process.exit(1);
    }
  }

  const mainSvg = existsSync(join(srcDir, `icon-${appKey}.svg`))
    ? `icon-${appKey}.svg`
    : "icon-foreground.svg";

  mkdirSync(outDir, { recursive: true });
  mkdirSync(resourcesDir, { recursive: true });

  console.log("--- Web/PWA icons ---");
  const icon1024 = await renderSvg(mainSvg, 1024);
  await writeIcon(icon1024, outDir, "AppIcon-1024.png");

  const icon512 = await renderSvg(mainSvg, 512);
  await writeIcon(icon512, outDir, "AppIcon-512.png");
  await writeIcon(icon512, outDir, "icon-512.png");

  const icon192 = await renderSvg(mainSvg, 192);
  await writeIcon(icon192, outDir, "icon-192.png");

  console.log("--- Maskable PWA icons ---");
  const maskable512 = await renderSvg("icon-maskable.svg", 512);
  await writeIcon(maskable512, outDir, "maskable-512.png");

  const maskable192 = await renderSvg("icon-maskable.svg", 192);
  await writeIcon(maskable192, outDir, "maskable-192.png");

  console.log("--- Android adaptive icon layers ---");
  const androidDir = join(resourcesDir, "android");
  mkdirSync(androidDir, { recursive: true });

  const fg512 = await renderSvg("icon-foreground.svg", 512);
  await writeIcon(fg512, androidDir, "ic_launcher_foreground.png");

  const bg512 = await renderSvg("icon-background.svg", 512);
  await writeIcon(bg512, androidDir, "ic_launcher_background.png");

  const mono512 = await renderSvg("icon-monochrome.svg", 512);
  await writeIcon(mono512, androidDir, "ic_launcher_monochrome.png");

  const appIcon512 = await renderSvg(mainSvg, 512);
  await writeIcon(appIcon512, androidDir, "AppIcon-512.png");

  console.log("--- iOS icon ---");
  const iosDir = join(resourcesDir, "ios");
  mkdirSync(iosDir, { recursive: true });

  const ios1024 = await renderSvg("icon-maskable.svg", 1024);
  await writeIcon(ios1024, iosDir, "AppIcon-1024.png");

  console.log("--- Splash screen ---");
  const splashDir = join(resourcesDir, "splash");
  mkdirSync(splashDir, { recursive: true });

  const splashBuf = await sharp({
    create: {
      width: 2732,
      height: 2732,
      channels: 4,
      background: { r: 10, g: 30, b: 61, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const logoOverlay = await renderSvg("icon-foreground.svg", 400);

  const splash = await sharp(splashBuf)
    .composite([
      {
        input: logoOverlay,
        gravity: "centre",
      },
    ])
    .png()
    .toBuffer();

  await writeIcon(splash, splashDir, "splash-2732x2732.png");

  const splashDark = await sharp({
    create: {
      width: 2732,
      height: 2732,
      channels: 4,
      background: { r: 10, g: 30, b: 61, alpha: 1 },
    },
  })
    .composite([
      {
        input: logoOverlay,
        gravity: "centre",
      },
    ])
    .png()
    .toBuffer();

  await writeIcon(splashDark, splashDir, "splash-dark-2732x2732.png");

  console.log(`\n=== ${appKey} COMPLETE ===\n`);
}

generate().catch((err) => {
  console.error(`Asset generation failed for ${appKey}:`, err);
  process.exit(1);
});
