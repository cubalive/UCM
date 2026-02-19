import { db } from "../db";
import { usStates, usCities } from "@shared/schema";
import { sql } from "drizzle-orm";

const ALL_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  { code: "DC", name: "District of Columbia" },
];

const CITIES: { state: string; city: string; pop?: number }[] = [
  // Nevada — FULL
  { state: "NV", city: "Las Vegas", pop: 641903 },
  { state: "NV", city: "Henderson", pop: 320189 },
  { state: "NV", city: "North Las Vegas", pop: 262527 },
  { state: "NV", city: "Reno", pop: 264165 },
  { state: "NV", city: "Sparks", pop: 108445 },
  { state: "NV", city: "Carson City", pop: 58639 },
  { state: "NV", city: "Fernley", pop: 22345 },
  { state: "NV", city: "Elko", pop: 20279 },
  { state: "NV", city: "Mesquite", pop: 19982 },
  { state: "NV", city: "Boulder City", pop: 16370 },
  { state: "NV", city: "Pahrump", pop: 44738 },
  { state: "NV", city: "Summerlin South", pop: 27000 },
  { state: "NV", city: "Spring Valley", pop: 215000 },
  { state: "NV", city: "Enterprise", pop: 171000 },
  { state: "NV", city: "Sunrise Manor", pop: 189000 },
  { state: "NV", city: "Whitney", pop: 44000 },
  { state: "NV", city: "Fallon", pop: 9576 },
  { state: "NV", city: "Winnemucca", pop: 8282 },
  { state: "NV", city: "West Wendover", pop: 4410 },
  { state: "NV", city: "Laughlin", pop: 7323 },
  { state: "NV", city: "Dayton", pop: 16000 },
  { state: "NV", city: "Gardnerville", pop: 6000 },
  { state: "NV", city: "Minden", pop: 3300 },
  { state: "NV", city: "Incline Village", pop: 9952 },
  { state: "NV", city: "Indian Springs", pop: 991 },
  { state: "NV", city: "Tonopah", pop: 2627 },
  { state: "NV", city: "Ely", pop: 4255 },
  { state: "NV", city: "Yerington", pop: 3101 },
  { state: "NV", city: "Lovelock", pop: 1813 },
  { state: "NV", city: "Caliente", pop: 1130 },
  { state: "NV", city: "Pioche", pop: 1000 },
  { state: "NV", city: "Hawthorne", pop: 3095 },
  { state: "NV", city: "Battle Mountain", pop: 3635 },
  // California
  { state: "CA", city: "Los Angeles", pop: 3898747 },
  { state: "CA", city: "San Diego", pop: 1386932 },
  { state: "CA", city: "San Jose", pop: 1013240 },
  { state: "CA", city: "San Francisco", pop: 873965 },
  { state: "CA", city: "Fresno", pop: 542107 },
  { state: "CA", city: "Sacramento", pop: 524943 },
  { state: "CA", city: "Long Beach", pop: 466742 },
  { state: "CA", city: "Oakland", pop: 433031 },
  { state: "CA", city: "Bakersfield", pop: 403455 },
  { state: "CA", city: "Anaheim", pop: 350365 },
  { state: "CA", city: "Santa Ana", pop: 310227 },
  { state: "CA", city: "Riverside", pop: 314998 },
  { state: "CA", city: "Stockton", pop: 320804 },
  { state: "CA", city: "Irvine", pop: 307670 },
  { state: "CA", city: "Chula Vista", pop: 275487 },
  { state: "CA", city: "Fremont", pop: 230504 },
  { state: "CA", city: "San Bernardino", pop: 222101 },
  { state: "CA", city: "Modesto", pop: 218464 },
  { state: "CA", city: "Fontana", pop: 214547 },
  { state: "CA", city: "Moreno Valley", pop: 212477 },
  { state: "CA", city: "Santa Clarita", pop: 228673 },
  { state: "CA", city: "Glendale", pop: 196543 },
  { state: "CA", city: "Huntington Beach", pop: 198711 },
  { state: "CA", city: "Garden Grove", pop: 172646 },
  { state: "CA", city: "Oceanside", pop: 175691 },
  { state: "CA", city: "Ontario", pop: 175265 },
  { state: "CA", city: "Rancho Cucamonga", pop: 177603 },
  { state: "CA", city: "Elk Grove", pop: 176124 },
  { state: "CA", city: "Corona", pop: 157136 },
  { state: "CA", city: "Palmdale", pop: 169450 },
  { state: "CA", city: "Lancaster", pop: 173516 },
  { state: "CA", city: "Salinas", pop: 163542 },
  { state: "CA", city: "Pomona", pop: 151348 },
  { state: "CA", city: "Escondido", pop: 151038 },
  { state: "CA", city: "Torrance", pop: 144522 },
  { state: "CA", city: "Pasadena", pop: 138699 },
  { state: "CA", city: "Sunnyvale", pop: 155805 },
  { state: "CA", city: "Roseville", pop: 147773 },
  { state: "CA", city: "Hayward", pop: 162954 },
  { state: "CA", city: "Visalia", pop: 141384 },
  { state: "CA", city: "Concord", pop: 129295 },
  // Texas
  { state: "TX", city: "Houston", pop: 2304580 },
  { state: "TX", city: "San Antonio", pop: 1434625 },
  { state: "TX", city: "Dallas", pop: 1304379 },
  { state: "TX", city: "Austin", pop: 978908 },
  { state: "TX", city: "Fort Worth", pop: 918915 },
  { state: "TX", city: "El Paso", pop: 678815 },
  { state: "TX", city: "Arlington", pop: 394266 },
  { state: "TX", city: "Corpus Christi", pop: 317863 },
  { state: "TX", city: "Plano", pop: 285494 },
  { state: "TX", city: "Laredo", pop: 255205 },
  { state: "TX", city: "Lubbock", pop: 257141 },
  { state: "TX", city: "Garland", pop: 239928 },
  { state: "TX", city: "Irving", pop: 256684 },
  { state: "TX", city: "Amarillo", pop: 200393 },
  { state: "TX", city: "Grand Prairie", pop: 196100 },
  { state: "TX", city: "Brownsville", pop: 186738 },
  { state: "TX", city: "McKinney", pop: 199177 },
  { state: "TX", city: "Frisco", pop: 200509 },
  { state: "TX", city: "Pasadena", pop: 151950 },
  { state: "TX", city: "Killeen", pop: 153095 },
  { state: "TX", city: "McAllen", pop: 142210 },
  { state: "TX", city: "Mesquite", pop: 150108 },
  { state: "TX", city: "Midland", pop: 132524 },
  { state: "TX", city: "Denton", pop: 139869 },
  { state: "TX", city: "Waco", pop: 138486 },
  // Florida
  { state: "FL", city: "Jacksonville", pop: 949611 },
  { state: "FL", city: "Miami", pop: 442241 },
  { state: "FL", city: "Tampa", pop: 384959 },
  { state: "FL", city: "Orlando", pop: 307573 },
  { state: "FL", city: "St. Petersburg", pop: 258308 },
  { state: "FL", city: "Hialeah", pop: 223109 },
  { state: "FL", city: "Port St. Lucie", pop: 217955 },
  { state: "FL", city: "Tallahassee", pop: 196169 },
  { state: "FL", city: "Cape Coral", pop: 194016 },
  { state: "FL", city: "Fort Lauderdale", pop: 182760 },
  { state: "FL", city: "Pembroke Pines", pop: 171178 },
  { state: "FL", city: "Hollywood", pop: 153627 },
  { state: "FL", city: "Gainesville", pop: 141085 },
  { state: "FL", city: "Miramar", pop: 134721 },
  { state: "FL", city: "Coral Springs", pop: 134394 },
  { state: "FL", city: "Clearwater", pop: 117284 },
  { state: "FL", city: "Palm Bay", pop: 119760 },
  { state: "FL", city: "Lakeland", pop: 112641 },
  { state: "FL", city: "West Palm Beach", pop: 117415 },
  // New York
  { state: "NY", city: "New York City", pop: 8336817 },
  { state: "NY", city: "Buffalo", pop: 278349 },
  { state: "NY", city: "Rochester", pop: 211328 },
  { state: "NY", city: "Yonkers", pop: 211569 },
  { state: "NY", city: "Syracuse", pop: 148620 },
  { state: "NY", city: "Albany", pop: 99224 },
  { state: "NY", city: "New Rochelle", pop: 79726 },
  { state: "NY", city: "Mount Vernon", pop: 73893 },
  { state: "NY", city: "Schenectady", pop: 67878 },
  // Illinois
  { state: "IL", city: "Chicago", pop: 2693976 },
  { state: "IL", city: "Aurora", pop: 180542 },
  { state: "IL", city: "Naperville", pop: 149540 },
  { state: "IL", city: "Joliet", pop: 150362 },
  { state: "IL", city: "Rockford", pop: 148655 },
  { state: "IL", city: "Springfield", pop: 114394 },
  { state: "IL", city: "Elgin", pop: 112456 },
  { state: "IL", city: "Peoria", pop: 113150 },
  // Pennsylvania
  { state: "PA", city: "Philadelphia", pop: 1603797 },
  { state: "PA", city: "Pittsburgh", pop: 302971 },
  { state: "PA", city: "Allentown", pop: 125845 },
  { state: "PA", city: "Reading", pop: 95112 },
  { state: "PA", city: "Erie", pop: 94831 },
  // Arizona
  { state: "AZ", city: "Phoenix", pop: 1608139 },
  { state: "AZ", city: "Tucson", pop: 542629 },
  { state: "AZ", city: "Mesa", pop: 504258 },
  { state: "AZ", city: "Chandler", pop: 275987 },
  { state: "AZ", city: "Scottsdale", pop: 241361 },
  { state: "AZ", city: "Gilbert", pop: 267918 },
  { state: "AZ", city: "Glendale", pop: 248325 },
  { state: "AZ", city: "Tempe", pop: 180587 },
  { state: "AZ", city: "Peoria", pop: 190985 },
  { state: "AZ", city: "Surprise", pop: 143148 },
  { state: "AZ", city: "Yuma", pop: 95548 },
  { state: "AZ", city: "Flagstaff", pop: 73964 },
  // Ohio
  { state: "OH", city: "Columbus", pop: 905748 },
  { state: "OH", city: "Cleveland", pop: 372624 },
  { state: "OH", city: "Cincinnati", pop: 309317 },
  { state: "OH", city: "Toledo", pop: 270871 },
  { state: "OH", city: "Akron", pop: 190469 },
  { state: "OH", city: "Dayton", pop: 137644 },
  // Georgia
  { state: "GA", city: "Atlanta", pop: 498715 },
  { state: "GA", city: "Augusta", pop: 202081 },
  { state: "GA", city: "Columbus", pop: 206922 },
  { state: "GA", city: "Savannah", pop: 147780 },
  { state: "GA", city: "Athens", pop: 127064 },
  // North Carolina
  { state: "NC", city: "Charlotte", pop: 874579 },
  { state: "NC", city: "Raleigh", pop: 467665 },
  { state: "NC", city: "Greensboro", pop: 299035 },
  { state: "NC", city: "Durham", pop: 283506 },
  { state: "NC", city: "Winston-Salem", pop: 249545 },
  { state: "NC", city: "Fayetteville", pop: 208501 },
  // Michigan
  { state: "MI", city: "Detroit", pop: 639111 },
  { state: "MI", city: "Grand Rapids", pop: 198917 },
  { state: "MI", city: "Warren", pop: 139387 },
  { state: "MI", city: "Sterling Heights", pop: 134346 },
  { state: "MI", city: "Ann Arbor", pop: 123851 },
  { state: "MI", city: "Lansing", pop: 112644 },
  // New Jersey
  { state: "NJ", city: "Newark", pop: 311549 },
  { state: "NJ", city: "Jersey City", pop: 292449 },
  { state: "NJ", city: "Paterson", pop: 159732 },
  { state: "NJ", city: "Elizabeth", pop: 137298 },
  { state: "NJ", city: "Trenton", pop: 90871 },
  // Virginia
  { state: "VA", city: "Virginia Beach", pop: 459470 },
  { state: "VA", city: "Norfolk", pop: 238005 },
  { state: "VA", city: "Chesapeake", pop: 249422 },
  { state: "VA", city: "Richmond", pop: 226610 },
  { state: "VA", city: "Newport News", pop: 186247 },
  { state: "VA", city: "Alexandria", pop: 159467 },
  // Washington
  { state: "WA", city: "Seattle", pop: 737015 },
  { state: "WA", city: "Spokane", pop: 228989 },
  { state: "WA", city: "Tacoma", pop: 219346 },
  { state: "WA", city: "Vancouver", pop: 190915 },
  { state: "WA", city: "Bellevue", pop: 151854 },
  // Massachusetts
  { state: "MA", city: "Boston", pop: 675647 },
  { state: "MA", city: "Worcester", pop: 206518 },
  { state: "MA", city: "Springfield", pop: 155929 },
  { state: "MA", city: "Cambridge", pop: 118403 },
  { state: "MA", city: "Lowell", pop: 115554 },
  // Tennessee
  { state: "TN", city: "Nashville", pop: 689447 },
  { state: "TN", city: "Memphis", pop: 633104 },
  { state: "TN", city: "Knoxville", pop: 190740 },
  { state: "TN", city: "Chattanooga", pop: 181099 },
  { state: "TN", city: "Clarksville", pop: 166722 },
  // Colorado
  { state: "CO", city: "Denver", pop: 715522 },
  { state: "CO", city: "Colorado Springs", pop: 478961 },
  { state: "CO", city: "Aurora", pop: 386261 },
  { state: "CO", city: "Fort Collins", pop: 169810 },
  { state: "CO", city: "Lakewood", pop: 155984 },
  // Indiana
  { state: "IN", city: "Indianapolis", pop: 887642 },
  { state: "IN", city: "Fort Wayne", pop: 263886 },
  { state: "IN", city: "Evansville", pop: 117298 },
  { state: "IN", city: "South Bend", pop: 103453 },
  // Missouri
  { state: "MO", city: "Kansas City", pop: 508090 },
  { state: "MO", city: "St. Louis", pop: 301578 },
  { state: "MO", city: "Springfield", pop: 169176 },
  { state: "MO", city: "Columbia", pop: 126254 },
  // Maryland
  { state: "MD", city: "Baltimore", pop: 585708 },
  { state: "MD", city: "Frederick", pop: 78171 },
  { state: "MD", city: "Rockville", pop: 68401 },
  // Wisconsin
  { state: "WI", city: "Milwaukee", pop: 577222 },
  { state: "WI", city: "Madison", pop: 269840 },
  { state: "WI", city: "Green Bay", pop: 107395 },
  // Minnesota
  { state: "MN", city: "Minneapolis", pop: 429954 },
  { state: "MN", city: "St. Paul", pop: 311527 },
  { state: "MN", city: "Rochester", pop: 121395 },
  // Oregon
  { state: "OR", city: "Portland", pop: 652503 },
  { state: "OR", city: "Salem", pop: 175535 },
  { state: "OR", city: "Eugene", pop: 176654 },
  // Louisiana
  { state: "LA", city: "New Orleans", pop: 383997 },
  { state: "LA", city: "Baton Rouge", pop: 227470 },
  { state: "LA", city: "Shreveport", pop: 187593 },
  // Oklahoma
  { state: "OK", city: "Oklahoma City", pop: 681054 },
  { state: "OK", city: "Tulsa", pop: 413066 },
  { state: "OK", city: "Norman", pop: 128026 },
  // Kentucky
  { state: "KY", city: "Louisville", pop: 633045 },
  { state: "KY", city: "Lexington", pop: 322570 },
  // Connecticut
  { state: "CT", city: "Bridgeport", pop: 148529 },
  { state: "CT", city: "New Haven", pop: 134023 },
  { state: "CT", city: "Hartford", pop: 121054 },
  { state: "CT", city: "Stamford", pop: 135470 },
  // South Carolina
  { state: "SC", city: "Charleston", pop: 150227 },
  { state: "SC", city: "Columbia", pop: 131674 },
  { state: "SC", city: "North Charleston", pop: 115382 },
  // Alabama
  { state: "AL", city: "Birmingham", pop: 200733 },
  { state: "AL", city: "Montgomery", pop: 200603 },
  { state: "AL", city: "Huntsville", pop: 215006 },
  { state: "AL", city: "Mobile", pop: 187041 },
  // Utah
  { state: "UT", city: "Salt Lake City", pop: 199723 },
  { state: "UT", city: "West Valley City", pop: 140230 },
  { state: "UT", city: "Provo", pop: 115162 },
  { state: "UT", city: "West Jordan", pop: 116961 },
  // Iowa
  { state: "IA", city: "Des Moines", pop: 214237 },
  { state: "IA", city: "Cedar Rapids", pop: 137710 },
  // Kansas
  { state: "KS", city: "Wichita", pop: 397532 },
  { state: "KS", city: "Overland Park", pop: 197238 },
  { state: "KS", city: "Kansas City", pop: 156607 },
  // Mississippi
  { state: "MS", city: "Jackson", pop: 153701 },
  // Arkansas
  { state: "AR", city: "Little Rock", pop: 202591 },
  // Nebraska
  { state: "NE", city: "Omaha", pop: 486051 },
  { state: "NE", city: "Lincoln", pop: 291082 },
  // New Mexico
  { state: "NM", city: "Albuquerque", pop: 564559 },
  { state: "NM", city: "Las Cruces", pop: 111385 },
  // Idaho
  { state: "ID", city: "Boise", pop: 235684 },
  { state: "ID", city: "Meridian", pop: 117635 },
  // Hawaii
  { state: "HI", city: "Honolulu", pop: 350964 },
  // New Hampshire
  { state: "NH", city: "Manchester", pop: 115644 },
  // Maine
  { state: "ME", city: "Portland", pop: 68408 },
  // Montana
  { state: "MT", city: "Billings", pop: 119602 },
  // Delaware
  { state: "DE", city: "Wilmington", pop: 70635 },
  // Rhode Island
  { state: "RI", city: "Providence", pop: 190934 },
  // South Dakota
  { state: "SD", city: "Sioux Falls", pop: 192517 },
  // North Dakota
  { state: "ND", city: "Fargo", pop: 125990 },
  // Alaska
  { state: "AK", city: "Anchorage", pop: 291247 },
  // Vermont
  { state: "VT", city: "Burlington", pop: 44743 },
  // West Virginia
  { state: "WV", city: "Charleston", pop: 48006 },
  // Wyoming
  { state: "WY", city: "Cheyenne", pop: 65132 },
  // DC
  { state: "DC", city: "Washington", pop: 689545 },
];

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function seedLocations() {
  console.log("[SEED-LOCATIONS] Starting...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS us_states (
      code VARCHAR(2) PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS us_cities (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      state_code VARCHAR(2) NOT NULL REFERENCES us_states(code),
      city TEXT NOT NULL,
      city_normalized TEXT NOT NULL,
      population INTEGER,
      is_major BOOLEAN NOT NULL DEFAULT true
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS us_cities_state_city_idx ON us_cities(state_code, city_normalized)
  `);

  await db.execute(sql`
    ALTER TABLE cities ADD COLUMN IF NOT EXISTS us_city_id INTEGER REFERENCES us_cities(id)
  `);

  console.log("[SEED-LOCATIONS] Tables ensured");

  for (const state of ALL_STATES) {
    await db.execute(
      sql`INSERT INTO us_states (code, name) VALUES (${state.code}, ${state.name}) ON CONFLICT (code) DO NOTHING`
    );
  }
  console.log(`[SEED-LOCATIONS] Upserted ${ALL_STATES.length} states`);

  let cityCount = 0;
  for (const c of CITIES) {
    const norm = normalize(c.city);
    await db.execute(
      sql`INSERT INTO us_cities (state_code, city, city_normalized, population, is_major)
          VALUES (${c.state}, ${c.city}, ${norm}, ${c.pop ?? null}, true)
          ON CONFLICT (state_code, city_normalized) DO UPDATE
          SET city = EXCLUDED.city, population = COALESCE(EXCLUDED.population, us_cities.population)`
    );
    cityCount++;
  }
  console.log(`[SEED-LOCATIONS] Upserted ${cityCount} cities`);

  const stateRows = await db.execute(sql`SELECT count(*) as cnt FROM us_states`);
  const cityRows = await db.execute(sql`SELECT count(*) as cnt FROM us_cities`);
  console.log(`[SEED-LOCATIONS] Final counts: ${(stateRows.rows?.[0] as any)?.cnt ?? "?"} states, ${(cityRows.rows?.[0] as any)?.cnt ?? "?"} cities`);
  console.log("[SEED-LOCATIONS] Done");
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("seed-locations.ts");
if (isMain) {
  seedLocations().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
