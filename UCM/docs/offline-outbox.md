# Offline Outbox

## Overview
The Offline Outbox provides an IndexedDB-backed queue for trip status updates and location pings when the driver is offline. Items are retried with exponential backoff and flushed automatically when connectivity resumes.

## Architecture
- **Storage**: IndexedDB database `ucm_outbox`, object store `outbox`
- **Item Types**: `trip_status` (status transitions) and `location` (GPS pings)
- **Ordering**: Trip status items are always processed before location items
- **Per-Trip Ordering**: Status items grouped by `orderingKey` (trip ID) and processed chronologically

## Queue Limits
| Type | Max Items |
|------|-----------|
| trip_status | 200 |
| location | 2,000 |

When limits are exceeded, oldest sent/processed items are evicted.

## Retry Strategy
Exponential backoff with the following delay schedule:
```
Attempt 1: 2s
Attempt 2: 5s
Attempt 3: 15s
Attempt 4: 45s
Attempt 5: 2min
Attempt 6+: 5min (cap)
```

## Failure Handling
- **4xx errors** (except 429): Marked as permanent failure, item removed from retry queue
- **5xx/network errors**: Retried with backoff
- **429 (rate limit)**: Retried with backoff
- **Ordering break**: If a status item fails with non-4xx error, remaining items for that trip are held

## Flush Triggers
- Periodic timer (default 30 seconds)
- Browser `online` event
- Page `visibilitychange` to visible (+ online)
- Manual flush call

## API
```typescript
enqueue(type, payload, orderingKey?)  // Add item to queue
getPendingItems()                      // Get items ready for send
markSending(id)                        // Mark item as sending
markSent(id)                           // Mark item as sent
markFailed(id, error, is4xx)           // Mark failed with retry logic
getQueuedCount()                       // Count unsent items
clearSent()                            // Remove sent items
flushQueue(sendFn)                     // Process all pending items
startPeriodicFlush(sendFn, intervalMs) // Start auto-flush
stopPeriodicFlush()                    // Stop auto-flush
```

## Files
- `client/src/lib/offlineOutbox.ts` — Queue implementation
