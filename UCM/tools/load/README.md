# UCM Load Test Harness

Load testing scripts using [autocannon](https://github.com/mcollina/autocannon).

## Prerequisites

1. Server running on `http://localhost:5000`
2. Valid admin auth token (set `AUTH_TOKEN` env var)

## Getting a Token

```bash
# Login as admin
curl -s http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ucm.com","password":"your-password"}' | jq -r '.token'
```

## Running Tests

```bash
# Set your auth token
export AUTH_TOKEN="your-jwt-token"
export BASE_URL="http://localhost:5000"  # optional, defaults to localhost:5000

# Run all scenarios
node tools/load/run-all.mjs

# Run individual scenarios
node tools/load/scenarios/trips-list.mjs
node tools/load/scenarios/driver-location.mjs
node tools/load/scenarios/tracking.mjs
node tools/load/scenarios/pdf-download.mjs
```

## Scenarios

| Scenario | Description | Simulates |
|----------|-------------|-----------|
| trips-list | Browse trips list with filters | Clinic/dispatch user |
| driver-location | GPS location updates | Active driver |
| tracking | Public trip tracking page | Patient/clinic |
| pdf-download | Trip PDF generation | Admin/dispatch |

## Interpreting Results

Output includes:
- **RPS**: Sustained requests per second
- **Latency**: p50, p95, p99 in ms
- **Throughput**: bytes/sec
- **Errors**: non-2xx responses and timeouts
