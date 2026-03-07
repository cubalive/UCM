import sharp from "sharp";
import { mkdirSync, writeFileSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "playstore-assets");

const PRIMARY = "#0A4DFF";
const ACCENT = "#00C389";
const WHITE = "#ffffff";
const TEXT_COLOR = "#ffffff";

const APPS = {
  driver: {
    title: "UCM Driver",
    subtitle: "Medical Transport Navigation",
    iconSvg: `<circle cx="512" cy="300" r="130" fill="none" stroke="${WHITE}" stroke-width="50"/>
      <circle cx="512" cy="300" r="32" fill="${ACCENT}"/>
      <path d="M512 430 L512 600" stroke="${WHITE}" stroke-width="60" stroke-linecap="round"/>
      <circle cx="512" cy="640" r="45" fill="${ACCENT}"/>`,
  },
  clinic: {
    title: "UCM Clinic",
    subtitle: "Patient Trip Management",
    iconSvg: `<rect x="380" y="200" width="260" height="260" rx="50" fill="${WHITE}"/>
      <rect x="497" y="260" width="50" height="160" fill="${PRIMARY}"/>
      <rect x="445" y="315" width="150" height="50" fill="${PRIMARY}"/>
      <rect x="475" y="480" width="75" height="75" rx="20" fill="${ACCENT}"/>`,
  },
  admin: {
    title: "UCM Dispatch",
    subtitle: "Transportation Control System",
    iconSvg: `<g fill="${WHITE}">
      <rect x="340" y="200" width="90" height="90" rx="16"/>
      <rect x="450" y="200" width="90" height="90" rx="16"/>
      <rect x="560" y="200" width="90" height="90" rx="16"/>
      <rect x="340" y="310" width="90" height="90" rx="16"/>
      <rect x="560" y="310" width="90" height="90" rx="16"/>
      <rect x="340" y="420" width="90" height="90" rx="16"/>
      <rect x="450" y="420" width="90" height="90" rx="16"/>
      <rect x="560" y="420" width="90" height="90" rx="16"/>
    </g>
    <rect x="450" y="310" width="90" height="90" rx="16" fill="${ACCENT}"/>`,
  },
};

async function generateFeatureGraphics() {
  console.log("--- Feature Graphics (1024x500) ---");

  for (const [key, app] of Object.entries(APPS)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
      <rect width="1024" height="500" fill="${PRIMARY}"/>
      <g transform="translate(-200, -80)">
        ${app.iconSvg}
      </g>
      <text x="580" y="220" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="bold" fill="${WHITE}">${app.title}</text>
      <text x="580" y="290" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="${ACCENT}">${app.subtitle}</text>
      <rect x="580" y="310" width="120" height="4" rx="2" fill="${ACCENT}" opacity="0.6"/>
    </svg>`;

    const outPath = join(OUT, key, `${key}-feature.png`);
    await sharp(Buffer.from(svg)).resize(1024, 500).png().toFile(outPath);
    console.log(`  [OK] ${key}-feature.png`);
  }
}

const SCREENSHOT_SCREENS = [
  { name: "01-login", title: "Sign In", content: "login" },
  { name: "02-map", title: "Live Map", content: "map" },
  { name: "03-trips", title: "Trip Management", content: "trips" },
  { name: "04-patient", title: "Patient Details", content: "patient" },
  { name: "05-dashboard", title: "Dashboard", content: "dashboard" },
];

function makeScreenshotSvg(appTitle, screen) {
  const statusBar = `<rect width="1080" height="48" fill="#1a1a2e"/>
    <text x="40" y="34" font-family="Arial" font-size="22" fill="${WHITE}">9:41</text>
    <text x="1000" y="34" font-family="Arial" font-size="22" fill="${WHITE}" text-anchor="end">100%</text>`;

  const header = `<rect y="48" width="1080" height="96" fill="${PRIMARY}"/>
    <text x="40" y="108" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="bold" fill="${WHITE}">${appTitle}</text>
    <text x="1040" y="108" font-family="Arial" font-size="28" fill="${WHITE}" text-anchor="end">${screen.title}</text>`;

  let body = "";
  switch (screen.content) {
    case "login":
      body = `
        <rect x="80" y="400" width="920" height="800" rx="24" fill="#f8f9fa" stroke="#e0e0e0" stroke-width="2"/>
        <text x="540" y="500" font-family="Arial" font-size="48" font-weight="bold" fill="${PRIMARY}" text-anchor="middle">${appTitle}</text>
        <text x="540" y="560" font-family="Arial" font-size="24" fill="#666" text-anchor="middle">Sign in to continue</text>
        <rect x="160" y="640" width="760" height="72" rx="12" fill="${WHITE}" stroke="#ddd" stroke-width="2"/>
        <text x="200" y="686" font-family="Arial" font-size="24" fill="#999">Email address</text>
        <rect x="160" y="740" width="760" height="72" rx="12" fill="${WHITE}" stroke="#ddd" stroke-width="2"/>
        <text x="200" y="786" font-family="Arial" font-size="24" fill="#999">Password</text>
        <rect x="160" y="880" width="760" height="72" rx="12" fill="${PRIMARY}"/>
        <text x="540" y="926" font-family="Arial" font-size="28" font-weight="bold" fill="${WHITE}" text-anchor="middle">Sign In</text>
        <text x="540" y="1020" font-family="Arial" font-size="22" fill="${PRIMARY}" text-anchor="middle">Send Magic Link instead</text>
        <text x="540" y="1100" font-family="Arial" font-size="20" fill="#999" text-anchor="middle">United Care Mobility</text>`;
      break;
    case "map":
      body = `
        <rect x="0" y="144" width="1080" height="1200" fill="#e8eaed"/>
        <path d="M0 144 L360 500 L720 350 L1080 600 L1080 1344 L0 1344 Z" fill="#d4e8d4" opacity="0.4"/>
        <line x1="0" y1="400" x2="1080" y2="400" stroke="#ccc" stroke-width="1"/>
        <line x1="0" y1="600" x2="1080" y2="600" stroke="#ccc" stroke-width="1"/>
        <line x1="0" y1="800" x2="1080" y2="800" stroke="#ccc" stroke-width="1"/>
        <line x1="360" y1="144" x2="360" y2="1344" stroke="#ccc" stroke-width="1"/>
        <line x1="720" y1="144" x2="720" y2="1344" stroke="#ccc" stroke-width="1"/>
        <rect x="200" y="500" width="680" height="4" rx="2" fill="${PRIMARY}" opacity="0.7"/>
        <circle cx="250" cy="502" r="16" fill="${ACCENT}"/>
        <circle cx="830" cy="502" r="16" fill="${PRIMARY}"/>
        <text x="250" y="546" font-family="Arial" font-size="18" fill="#333" text-anchor="middle">Pickup</text>
        <text x="830" y="546" font-family="Arial" font-size="18" fill="#333" text-anchor="middle">Dropoff</text>
        <rect x="60" y="1360" width="960" height="200" rx="20" fill="${WHITE}" stroke="#e0e0e0" stroke-width="2"/>
        <text x="100" y="1410" font-family="Arial" font-size="24" font-weight="bold" fill="#333">En Route to Pickup</text>
        <text x="100" y="1450" font-family="Arial" font-size="20" fill="#666">ETA: 8 min · 3.2 mi</text>
        <rect x="800" y="1380" width="180" height="56" rx="10" fill="${ACCENT}"/>
        <text x="890" y="1416" font-family="Arial" font-size="22" font-weight="bold" fill="${WHITE}" text-anchor="middle">Navigate</text>`;
      break;
    case "trips":
      body = `
        <rect x="40" y="170" width="1000" height="72" rx="12" fill="#f0f2f5"/>
        <text x="80" y="216" font-family="Arial" font-size="22" fill="#999">Search trips...</text>
        ${[0, 1, 2, 3].map(i => {
          const y = 280 + i * 220;
          const statuses = ["In Progress", "Scheduled", "Completed", "Pending"];
          const colors = [ACCENT, PRIMARY, "#6c757d", "#ffc107"];
          return `
            <rect x="40" y="${y}" width="1000" height="200" rx="16" fill="${WHITE}" stroke="#e8e8e8" stroke-width="2"/>
            <text x="80" y="${y + 44}" font-family="Arial" font-size="26" font-weight="bold" fill="#333">Trip #${1042 + i}</text>
            <rect x="820" y="${y + 20}" width="180" height="36" rx="18" fill="${colors[i]}" opacity="0.15"/>
            <text x="910" y="${y + 45}" font-family="Arial" font-size="18" fill="${colors[i]}" text-anchor="middle">${statuses[i]}</text>
            <text x="80" y="${y + 84}" font-family="Arial" font-size="20" fill="#666">Patient: John D. · Dialysis</text>
            <text x="80" y="${y + 120}" font-family="Arial" font-size="18" fill="#999">Pickup: 123 Main St → City Dialysis Center</text>
            <text x="80" y="${y + 160}" font-family="Arial" font-size="18" fill="#999">Scheduled: 2:30 PM · Driver: Mike R.</text>`;
        }).join("")}`;
      break;
    case "patient":
      body = `
        <rect x="40" y="180" width="1000" height="360" rx="20" fill="${WHITE}" stroke="#e8e8e8" stroke-width="2"/>
        <circle cx="180" cy="320" r="70" fill="${PRIMARY}" opacity="0.1"/>
        <text x="180" y="334" font-family="Arial" font-size="40" font-weight="bold" fill="${PRIMARY}" text-anchor="middle">JD</text>
        <text x="300" y="280" font-family="Arial" font-size="32" font-weight="bold" fill="#333">John Doe</text>
        <text x="300" y="320" font-family="Arial" font-size="22" fill="#666">Dialysis Patient · Wheelchair</text>
        <text x="300" y="360" font-family="Arial" font-size="20" fill="#999">Phone: (555) 123-4567</text>
        <text x="300" y="400" font-family="Arial" font-size="20" fill="#999">Insurance: Medicare #12345</text>
        <rect x="300" y="430" width="120" height="36" rx="18" fill="${ACCENT}" opacity="0.15"/>
        <text x="360" y="455" font-family="Arial" font-size="16" fill="${ACCENT}" text-anchor="middle">Active</text>
        <text x="80" y="610" font-family="Arial" font-size="26" font-weight="bold" fill="#333">Upcoming Trips</text>
        ${[0, 1, 2].map(i => {
          const y = 650 + i * 160;
          return `
            <rect x="40" y="${y}" width="1000" height="140" rx="12" fill="#f8f9fa"/>
            <text x="80" y="${y + 40}" font-family="Arial" font-size="22" font-weight="bold" fill="#333">Mar ${6 + i}, 2026 · ${["9:00 AM", "2:30 PM", "10:00 AM"][i]}</text>
            <text x="80" y="${y + 76}" font-family="Arial" font-size="18" fill="#666">${["City Dialysis Center", "Metro Health Clinic", "Sunrise Medical"][i]}</text>
            <text x="80" y="${y + 108}" font-family="Arial" font-size="16" fill="#999">Round Trip · ${["Driver: Mike R.", "Driver: Sarah K.", "Unassigned"][i]}</text>`;
        }).join("")}`;
      break;
    case "dashboard":
      body = `
        ${[
          { label: "Active Trips", value: "12", color: ACCENT },
          { label: "Drivers Online", value: "8", color: PRIMARY },
          { label: "Pending", value: "5", color: "#ffc107" },
          { label: "Completed Today", value: "34", color: "#6c757d" },
        ].map((stat, i) => {
          const x = 40 + (i % 2) * 520;
          const y = 180 + Math.floor(i / 2) * 200;
          return `
            <rect x="${x}" y="${y}" width="480" height="170" rx="16" fill="${WHITE}" stroke="#e8e8e8" stroke-width="2"/>
            <text x="${x + 40}" y="${y + 60}" font-family="Arial" font-size="20" fill="#999">${stat.label}</text>
            <text x="${x + 40}" y="${y + 120}" font-family="Arial" font-size="56" font-weight="bold" fill="${stat.color}">${stat.value}</text>`;
        }).join("")}
        <text x="80" y="640" font-family="Arial" font-size="26" font-weight="bold" fill="#333">Recent Activity</text>
        ${[0, 1, 2, 3, 4].map(i => {
          const y = 670 + i * 100;
          const events = [
            "Trip #1042 started — Driver Mike R.",
            "Trip #1041 completed — 23 min",
            "Driver Sarah K. went online",
            "New booking: John D. — Dialysis",
            "Trip #1040 assigned to Tom B.",
          ];
          return `
            <rect x="40" y="${y}" width="1000" height="80" rx="10" fill="${i % 2 === 0 ? '#f8f9fa' : WHITE}"/>
            <circle cx="80" cy="${y + 40}" r="8" fill="${[ACCENT, "#6c757d", PRIMARY, "#ffc107", PRIMARY][i]}"/>
            <text x="110" y="${y + 46}" font-family="Arial" font-size="20" fill="#333">${events[i]}</text>
            <text x="980" y="${y + 46}" font-family="Arial" font-size="16" fill="#999" text-anchor="end">${i + 1}m ago</text>`;
        }).join("")}`;
      break;
  }

  const navBar = `<rect y="1824" width="1080" height="96" fill="${WHITE}" stroke="#e0e0e0" stroke-width="1"/>
    <text x="180" y="1882" font-family="Arial" font-size="20" fill="${PRIMARY}" text-anchor="middle">Home</text>
    <text x="540" y="1882" font-family="Arial" font-size="20" fill="#999" text-anchor="middle">Trips</text>
    <text x="900" y="1882" font-family="Arial" font-size="20" fill="#999" text-anchor="middle">Settings</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
    <rect width="1080" height="1920" fill="#f5f5f5"/>
    ${statusBar}
    ${header}
    ${body}
    ${navBar}
  </svg>`;
}

async function generateScreenshots() {
  console.log("\n--- Screenshots (1080x1920) ---");

  for (const [key, app] of Object.entries(APPS)) {
    const screenshotDir = join(OUT, "screenshots", key);
    mkdirSync(screenshotDir, { recursive: true });

    for (const screen of SCREENSHOT_SCREENS) {
      const svg = makeScreenshotSvg(app.title, screen);
      const outPath = join(screenshotDir, `${screen.name}.png`);
      await sharp(Buffer.from(svg)).resize(1080, 1920).png().toFile(outPath);
      console.log(`  [OK] ${key}/${screen.name}.png`);
    }
  }
}

async function generateMetadata() {
  console.log("\n--- Metadata ---");

  const metadata = {
    driver: {
      title: "UCM Driver",
      shortDescription: "Driver navigation for medical transportation",
      fullDescription: "UCM Driver allows medical transport drivers to manage dialysis and clinic trips, receive dispatch updates, and navigate safely.",
    },
    clinic: {
      title: "UCM Clinic",
      shortDescription: "Clinic transportation management",
      fullDescription: "UCM Clinic enables healthcare clinics to schedule and monitor patient transportation in real time.",
    },
    admin: {
      title: "UCM Dispatch",
      shortDescription: "Dispatch and fleet control",
      fullDescription: "UCM Dispatch provides real-time control over drivers, trips, clinics and patient transportation logistics.",
    },
  };

  writeFileSync(join(OUT, "metadata.json"), JSON.stringify(metadata, null, 2));
  console.log("  [OK] metadata.json");
}

async function main() {
  mkdirSync(join(OUT, "driver"), { recursive: true });
  mkdirSync(join(OUT, "clinic"), { recursive: true });
  mkdirSync(join(OUT, "admin"), { recursive: true });

  await generateFeatureGraphics();
  await generateScreenshots();
  await generateMetadata();

  console.log("\nPlay Store assets generated successfully.");
}

main().catch((err) => {
  console.error("Generation failed:", err);
  process.exit(1);
});
