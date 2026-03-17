/**
 * UCM Credential Management Script
 *
 * Lists all users/roles and optionally resets or creates test credentials.
 *
 * Usage:
 *   npx tsx script/reset-credentials.ts list          # List all users
 *   npx tsx script/reset-credentials.ts reset         # Reset/create all test users
 *   npx tsx script/reset-credentials.ts reset --dry   # Dry run (no changes)
 */

import { db } from "../server/db";
import { users, companies, cities, userCityAccess } from "../shared/schema";
import { hashPassword } from "../server/auth";
import { generatePublicId } from "../server/public-id";
import { eq, sql, isNull, desc } from "drizzle-orm";

// ─── Credential Definitions ─────────────────────────────────────────────────

interface CredentialDef {
  email: string;
  password: string;
  role: string;
  firstName: string;
  lastName: string;
  portalUrl: string;
  needsCompany?: boolean;
  needsClinic?: boolean;
  needsDriver?: boolean;
  needsPharmacy?: boolean;
  needsBroker?: boolean;
}

const CREDENTIALS: CredentialDef[] = [
  {
    email: "superadmin@unitedcaremobility.com",
    password: "UCM_Admin_2026!",
    role: "SUPER_ADMIN",
    firstName: "Super",
    lastName: "Admin",
    portalUrl: "/dashboard",
  },
  {
    email: "admin@unitedcaremobility.com",
    password: "UCM_Admin_2026!",
    role: "ADMIN",
    firstName: "Admin",
    lastName: "UCM",
    portalUrl: "/dashboard",
    needsCompany: true,
  },
  {
    email: "companyadmin@unitedcaremobility.com",
    password: "UCM_Company_2026!",
    role: "COMPANY_ADMIN",
    firstName: "Company",
    lastName: "Admin",
    portalUrl: "/dashboard",
    needsCompany: true,
  },
  {
    email: "dispatcher@unitedcaremobility.com",
    password: "UCM_Disp_2026!",
    role: "DISPATCH",
    firstName: "Dispatch",
    lastName: "User",
    portalUrl: "/dispatch",
    needsCompany: true,
  },
  {
    email: "driver@unitedcaremobility.com",
    password: "UCM_Driver_2026!",
    role: "DRIVER",
    firstName: "Test",
    lastName: "Driver",
    portalUrl: "/driver",
    needsCompany: true,
    needsDriver: true,
  },
  {
    email: "clinic@unitedcaremobility.com",
    password: "UCM_Clinic_2026!",
    role: "CLINIC_ADMIN",
    firstName: "Clinic",
    lastName: "Admin",
    portalUrl: "/clinic",
    needsCompany: true,
    needsClinic: true,
  },
  {
    email: "pharmacy@unitedcaremobility.com",
    password: "UCM_Pharma_2026!",
    role: "PHARMACY_ADMIN",
    firstName: "Pharmacy",
    lastName: "Admin",
    portalUrl: "/pharmacy",
    needsCompany: true,
    needsPharmacy: true,
  },
  {
    email: "broker@unitedcaremobility.com",
    password: "UCM_Broker_2026!",
    role: "BROKER_ADMIN",
    firstName: "Broker",
    lastName: "Admin",
    portalUrl: "/broker",
    needsCompany: true,
    needsBroker: true,
  },
];

// ─── List Command ────────────────────────────────────────────────────────────

async function listUsers() {
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  UCM PLATFORM — EXISTING USERS");
  console.log("══════════════════════════════════════════════════════════\n");

  const allUsers = await db
    .select({
      id: users.id,
      publicId: users.publicId,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      active: users.active,
      companyId: users.companyId,
      clinicId: users.clinicId,
      driverId: users.driverId,
      pharmacyId: users.pharmacyId,
      brokerId: users.brokerId,
      createdAt: users.createdAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .orderBy(users.role, users.createdAt);

  if (allUsers.length === 0) {
    console.log("  No users found in the database.\n");
  } else {
    console.log(
      `  ${"ID".padEnd(5)} ${"ROLE".padEnd(16)} ${"EMAIL".padEnd(40)} ${"NAME".padEnd(25)} ${"ACTIVE".padEnd(8)} ${"COMPANY"}`
    );
    console.log("  " + "─".repeat(110));

    for (const u of allUsers) {
      if (u.deletedAt) continue; // skip soft-deleted
      console.log(
        `  ${String(u.id).padEnd(5)} ${(u.role || "").padEnd(16)} ${(u.email || "").padEnd(40)} ${((u.firstName || "") + " " + (u.lastName || "")).padEnd(25)} ${(u.active ? "YES" : "NO").padEnd(8)} ${u.companyId || "—"}`
      );
    }
  }

  // List companies
  const allCompanies = await db.select().from(companies).orderBy(companies.name);
  console.log("\n  COMPANIES:");
  console.log("  " + "─".repeat(50));
  if (allCompanies.length === 0) {
    console.log("  No companies found.");
  } else {
    for (const c of allCompanies) {
      console.log(`  ${String(c.id).padEnd(5)} ${c.name}`);
    }
  }

  // List cities
  const allCities = await db.select().from(cities).orderBy(cities.name);
  console.log("\n  CITIES:");
  console.log("  " + "─".repeat(50));
  for (const c of allCities) {
    console.log(`  ${String(c.id).padEnd(5)} ${c.name}, ${c.state} (${c.timezone}) ${c.active ? "" : "[INACTIVE]"}`);
  }

  // Roles summary
  const roleCounts = await db
    .select({ role: users.role, count: sql<number>`count(*)` })
    .from(users)
    .where(isNull(users.deletedAt))
    .groupBy(users.role);

  console.log("\n  ROLE DISTRIBUTION:");
  console.log("  " + "─".repeat(30));
  for (const r of roleCounts) {
    console.log(`  ${(r.role || "NULL").padEnd(20)} ${r.count}`);
  }

  console.log("\n══════════════════════════════════════════════════════════\n");
}

// ─── Reset Command ───────────────────────────────────────────────────────────

async function resetCredentials(dryRun: boolean) {
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  UCM PLATFORM — CREDENTIAL RESET");
  console.log(`  Mode: ${dryRun ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log("══════════════════════════════════════════════════════════\n");

  // Ensure at least one company exists
  let [company] = await db.select().from(companies).limit(1);
  if (!company) {
    if (dryRun) {
      console.log("  [DRY] Would create company: United Care Mobility");
    } else {
      [company] = await db
        .insert(companies)
        .values({ name: "United Care Mobility" })
        .returning();
      console.log(`  ✅ Created company: ${company.name} (ID: ${company.id})`);
    }
  }

  // Ensure Las Vegas city exists
  let [lvCity] = await db
    .select()
    .from(cities)
    .where(eq(cities.name, "Las Vegas"))
    .limit(1);
  if (!lvCity) {
    if (dryRun) {
      console.log("  [DRY] Would create city: Las Vegas, NV");
    } else {
      [lvCity] = await db
        .insert(cities)
        .values({
          name: "Las Vegas",
          state: "NV",
          timezone: "America/Los_Angeles",
          active: true,
        })
        .onConflictDoNothing()
        .returning();
      if (lvCity) {
        console.log(`  ✅ Created city: Las Vegas, NV (ID: ${lvCity.id})`);
      } else {
        [lvCity] = await db.select().from(cities).where(eq(cities.name, "Las Vegas")).limit(1);
      }
    }
  }

  const results: Array<{ action: string; role: string; email: string; password: string; portal: string }> = [];

  for (const cred of CREDENTIALS) {
    const existing = await db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = ${cred.email.toLowerCase()}`)
      .limit(1);

    if (existing.length > 0) {
      // Update password
      if (dryRun) {
        console.log(`  [DRY] Would reset password for: ${cred.email} (${cred.role})`);
      } else {
        const hashed = await hashPassword(cred.password);
        await db
          .update(users)
          .set({
            password: hashed,
            active: true,
            mustChangePassword: false,
          })
          .where(eq(users.id, existing[0].id));
        console.log(`  🔄 RESET  | ${cred.role.padEnd(16)} | ${cred.email}`);
      }
      results.push({ action: "RESET", role: cred.role, email: cred.email, password: cred.password, portal: cred.portalUrl });
    } else {
      // Create user
      if (dryRun) {
        console.log(`  [DRY] Would create user: ${cred.email} (${cred.role})`);
      } else {
        const hashed = await hashPassword(cred.password);
        const publicId = await generatePublicId();

        const userData: any = {
          publicId,
          email: cred.email,
          password: hashed,
          firstName: cred.firstName,
          lastName: cred.lastName,
          role: cred.role,
          active: true,
          mustChangePassword: false,
        };

        // Link to company (all roles except SUPER_ADMIN)
        if (cred.needsCompany && company) {
          userData.companyId = company.id;
        }

        const [newUser] = await db.insert(users).values(userData).returning();

        // Grant city access
        if (lvCity && newUser) {
          await db
            .insert(userCityAccess)
            .values({ userId: newUser.id, cityId: lvCity.id })
            .onConflictDoNothing();
        }

        console.log(`  🆕 CREATE | ${cred.role.padEnd(16)} | ${cred.email}`);
      }
      results.push({ action: "CREATE", role: cred.role, email: cred.email, password: cred.password, portal: cred.portalUrl });
    }
  }

  // Print final summary
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  UCM PLATFORM — ACCESS CREDENTIALS");
  console.log(`  Generated: ${new Date().toISOString().split("T")[0]}`);
  console.log("══════════════════════════════════════════════════════════");
  console.log(
    `  ${"ROLE".padEnd(18)} ${"EMAIL".padEnd(42)} ${"PASSWORD".padEnd(22)} PORTAL`
  );
  console.log("  " + "─".repeat(100));

  for (const r of results) {
    console.log(
      `  ${r.role.padEnd(18)} ${r.email.padEnd(42)} ${r.password.padEnd(22)} ${r.portal}`
    );
  }

  console.log("══════════════════════════════════════════════════════════\n");

  if (!dryRun) {
    console.log("  ⚠️  IMPORTANT REMINDERS:");
    console.log("  1. Change ALL these passwords in production");
    console.log("  2. Enable MFA for the Super Admin account");
    console.log("  3. Delete or disable test accounts not needed in production");
    console.log("");
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const command = process.argv[2] || "list";
  const dryRun = process.argv.includes("--dry");

  try {
    if (command === "list") {
      await listUsers();
    } else if (command === "reset") {
      await resetCredentials(dryRun);
    } else {
      console.log("Usage:");
      console.log("  npx tsx script/reset-credentials.ts list          # List all users");
      console.log("  npx tsx script/reset-credentials.ts reset         # Reset/create credentials");
      console.log("  npx tsx script/reset-credentials.ts reset --dry   # Dry run");
    }
  } catch (err: any) {
    console.error("Error:", err.message);
  }

  process.exit(0);
}

main();
