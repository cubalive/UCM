import autocannon from "autocannon";

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const TOKEN = process.env.AUTH_TOKEN;
const DRIVER_ID = process.env.DRIVER_ID || "1";

if (!TOKEN) {
  console.error("ERROR: Set AUTH_TOKEN env var first");
  process.exit(1);
}

console.log("Scenario B: Driver active-trip + location updates");
console.log(`Target: ${BASE_URL}, Driver: ${DRIVER_ID}`);
console.log("---");

let lat = 40.7128;
let lng = -74.006;

const result = await autocannon({
  url: `${BASE_URL}/api/driver/location`,
  connections: 5,
  duration: 15,
  method: "POST",
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  },
  setupClient(client) {
    client.setBody(JSON.stringify({
      driverId: parseInt(DRIVER_ID),
      lat: lat + (Math.random() - 0.5) * 0.01,
      lng: lng + (Math.random() - 0.5) * 0.01,
      timestamp: Date.now(),
      heading: Math.floor(Math.random() * 360),
      speed: Math.random() * 30,
      accuracy: 5 + Math.random() * 20,
    }));
  },
});

console.log(autocannon.printResult(result));
process.exit(0);
