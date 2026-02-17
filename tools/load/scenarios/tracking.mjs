import autocannon from "autocannon";

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const TOKEN = process.env.AUTH_TOKEN;

if (!TOKEN) {
  console.error("ERROR: Set AUTH_TOKEN env var first");
  process.exit(1);
}

console.log("Scenario C: Dispatch map view / trip tracking");
console.log(`Target: ${BASE_URL}`);
console.log("---");

const result = await autocannon({
  url: `${BASE_URL}/api/trips?cityId=1`,
  connections: 10,
  duration: 15,
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  },
  requests: [
    { method: "GET", path: "/api/trips?cityId=1&status=IN_PROGRESS" },
    { method: "GET", path: "/api/drivers?cityId=1" },
    { method: "GET", path: "/api/ops/metrics" },
  ],
});

console.log(autocannon.printResult(result));
process.exit(0);
