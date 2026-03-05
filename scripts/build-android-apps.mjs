import { execSync } from "child_process";
import fs from "fs";
import path from "path";

function run(cmd) {
  console.log("Running:", cmd);
  execSync(cmd, { stdio: "inherit" });
}

run("npx cap sync android");

run("cd android && ./gradlew bundleRelease");

const source = "android/app/build/outputs/bundle/release/app-release.aab";

const dist = "android-builds";

if (!fs.existsSync(dist)) {
  fs.mkdirSync(dist);
}

fs.copyFileSync(source, `${dist}/driver.aab`);
fs.copyFileSync(source, `${dist}/clinic.aab`);
fs.copyFileSync(source, `${dist}/dispatch.aab`);

console.log("\nBuilds created:");
console.log("  android-builds/driver.aab");
console.log("  android-builds/clinic.aab");
console.log("  android-builds/dispatch.aab");
console.log("\nTo build, run:");
console.log("  node scripts/build-android-apps.mjs");
