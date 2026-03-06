import { setNx, compareAndRenew, compareAndDelete, getString } from "./redis";
import crypto from "crypto";

const LEADER_KEY = "ucm:worker:leader";
const LEADER_TTL_SECONDS = parseInt(process.env.LEADER_LOCK_TTL_SECONDS || "30", 10);
const RENEWAL_INTERVAL_MS = Math.max((LEADER_TTL_SECONDS * 1000) / 3, 3000);

const instanceId = `${process.pid}:${crypto.randomUUID().slice(0, 8)}:${Date.now()}`;

let isLeader = false;
let renewalTimer: ReturnType<typeof setInterval> | null = null;
let electionTimer: ReturnType<typeof setInterval> | null = null;
let onLostCallbacks: Array<() => void> = [];
let onAcquiredCallbacks: Array<() => void> = [];

export function getInstanceId(): string {
  return instanceId;
}

export function isCurrentLeader(): boolean {
  return isLeader;
}

export function onLeadershipLost(cb: () => void): void {
  onLostCallbacks.push(cb);
}

export function onLeadershipAcquired(cb: () => void): void {
  onAcquiredCallbacks.push(cb);
}

async function tryAcquireLeadership(): Promise<boolean> {
  try {
    const acquired = await setNx(LEADER_KEY, instanceId, LEADER_TTL_SECONDS);
    if (acquired) {
      if (!isLeader) {
        isLeader = true;
        console.log(JSON.stringify({
          event: "leader_acquired",
          instanceId,
          ttl: LEADER_TTL_SECONDS,
          ts: new Date().toISOString(),
        }));
        for (const cb of onAcquiredCallbacks) {
          try { cb(); } catch (err: any) {
            console.error(`[LEADER] onAcquired callback error: ${err.message}`);
          }
        }
      }
      startRenewal();
      return true;
    }
    return false;
  } catch (err: any) {
    console.warn(JSON.stringify({
      event: "leader_election_error",
      error: err.message,
      instanceId,
      ts: new Date().toISOString(),
    }));
    return false;
  }
}

async function renewLeadership(): Promise<boolean> {
  try {
    const renewed = await compareAndRenew(LEADER_KEY, instanceId, LEADER_TTL_SECONDS);
    if (!renewed) {
      handleLeadershipLost("renewal_failed");
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn(JSON.stringify({
      event: "leader_renewal_error",
      error: err.message,
      instanceId,
      ts: new Date().toISOString(),
    }));
    return false;
  }
}

function handleLeadershipLost(reason: string): void {
  if (!isLeader) return;
  isLeader = false;

  console.warn(JSON.stringify({
    event: "leader_lost",
    reason,
    instanceId,
    ts: new Date().toISOString(),
  }));

  stopRenewal();

  for (const cb of onLostCallbacks) {
    try { cb(); } catch (err: any) {
      console.error(`[LEADER] onLost callback error: ${err.message}`);
    }
  }
}

function startRenewal(): void {
  if (renewalTimer) return;
  renewalTimer = setInterval(async () => {
    await renewLeadership();
  }, RENEWAL_INTERVAL_MS);
}

function stopRenewal(): void {
  if (renewalTimer) {
    clearInterval(renewalTimer);
    renewalTimer = null;
  }
}

export async function startLeaderElection(): Promise<void> {
  await tryAcquireLeadership();

  if (electionTimer) return;
  electionTimer = setInterval(async () => {
    if (!isLeader) {
      await tryAcquireLeadership();
    }
  }, LEADER_TTL_SECONDS * 1000);

  console.log(JSON.stringify({
    event: "leader_election_started",
    instanceId,
    isLeader,
    retryIntervalS: LEADER_TTL_SECONDS,
    renewalIntervalMs: RENEWAL_INTERVAL_MS,
    ts: new Date().toISOString(),
  }));
}

export async function stopLeaderElection(): Promise<void> {
  if (electionTimer) {
    clearInterval(electionTimer);
    electionTimer = null;
  }
  stopRenewal();

  if (isLeader) {
    try {
      await compareAndDelete(LEADER_KEY, instanceId);
      console.log(JSON.stringify({
        event: "leader_released",
        instanceId,
        ts: new Date().toISOString(),
      }));
    } catch (e) { console.warn("[LEADER] release error:", e); }
  }

  isLeader = false;
  onLostCallbacks = [];
  onAcquiredCallbacks = [];
}

export async function getLeaderInfo(): Promise<{
  currentLeader: string | null;
  isThisInstanceLeader: boolean;
  instanceId: string;
}> {
  let currentLeader: string | null = null;
  try {
    currentLeader = await getString(LEADER_KEY);
  } catch (e) { console.warn("[LEADER] getLeaderInfo error:", e); }

  return {
    currentLeader,
    isThisInstanceLeader: isLeader,
    instanceId,
  };
}
