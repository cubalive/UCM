import autocannon from "autocannon";

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const TOKEN = process.env.AUTH_TOKEN;
const TRIP_ID = process.env.TRIP_ID || "1";

if (!TOKEN) {
  console.error("ERROR: Set AUTH_TOKEN env var first");
  process.exit(1);
}

console.log("Scenario D: PDF download (trip detail)");
console.log(`Target: ${BASE_URL}, Trip: ${TRIP_ID}`);
console.log("---");

const result = await autocannon({
  url: `${BASE_URL}/api/trips/${TRIP_ID}/pdf`,
  connections: 3,
  duration: 10,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
  },
});

console.log(autocannon.printResult(result));
process.exit(0);
