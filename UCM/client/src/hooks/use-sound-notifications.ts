import { useCallback, useEffect, useRef, useState } from "react";

export type SoundType =
  | "trip_assigned"
  | "trip_completed"
  | "trip_cancelled"
  | "trip_no_show"
  | "new_trip"
  | "status_change"
  | "alert_critical"
  | "alert_warning"
  | "notification"
  | "message";

const STORAGE_KEY = "ucm_sound_enabled";
const INIT_DEFAULT_KEY = "ucm_sound_default_set";

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"];
const CLINIC_ROLES = ["CLINIC_USER", "CLINIC_ADMIN", "VIEWER"];

function getDefaultForRole(role?: string): boolean {
  if (!role) return true;
  const upper = role.toUpperCase();
  if (CLINIC_ROLES.includes(upper)) return false;
  return true;
}

function initSoundDefault(role?: string): boolean {
  try {
    const alreadySet = localStorage.getItem(INIT_DEFAULT_KEY);
    if (alreadySet) {
      return localStorage.getItem(STORAGE_KEY) !== "false";
    }
    const defaultVal = getDefaultForRole(role);
    localStorage.setItem(STORAGE_KEY, String(defaultVal));
    localStorage.setItem(INIT_DEFAULT_KEY, "true");
    return defaultVal;
  } catch {
    return getDefaultForRole(role);
  }
}

export function isSoundEnabled(): boolean {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    return val !== "false";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    localStorage.setItem(INIT_DEFAULT_KEY, "true");
  } catch {}
}

interface ToneNote {
  freq: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
}

const SOUND_PATTERNS: Record<SoundType, ToneNote[]> = {
  new_trip: [
    { freq: 523, dur: 100, type: "sine" },
    { freq: 659, dur: 100, type: "sine" },
    { freq: 784, dur: 150, type: "sine" },
  ],
  trip_assigned: [
    { freq: 587, dur: 120, type: "sine" },
    { freq: 784, dur: 120, type: "sine" },
    { freq: 880, dur: 150, type: "sine" },
  ],
  trip_completed: [
    { freq: 659, dur: 100, type: "sine" },
    { freq: 784, dur: 100, type: "sine" },
    { freq: 1047, dur: 200, type: "sine", vol: 0.12 },
  ],
  trip_cancelled: [
    { freq: 440, dur: 200, type: "square", vol: 0.08 },
    { freq: 349, dur: 300, type: "square", vol: 0.06 },
  ],
  trip_no_show: [
    { freq: 880, dur: 150, type: "square", vol: 0.1 },
    { freq: 880, dur: 150, type: "square", vol: 0.1 },
    { freq: 660, dur: 250, type: "square", vol: 0.08 },
  ],
  status_change: [
    { freq: 660, dur: 80, type: "sine" },
    { freq: 880, dur: 120, type: "sine" },
  ],
  alert_critical: [
    { freq: 1000, dur: 200, type: "square", vol: 0.12 },
    { freq: 1000, dur: 200, type: "square", vol: 0.12 },
    { freq: 800, dur: 300, type: "square", vol: 0.1 },
  ],
  alert_warning: [
    { freq: 600, dur: 150, type: "sine" },
    { freq: 800, dur: 200, type: "sine" },
  ],
  notification: [
    { freq: 659, dur: 80, type: "sine" },
    { freq: 880, dur: 120, type: "sine" },
  ],
  message: [
    { freq: 1200, dur: 60, type: "sine", vol: 0.1 },
    { freq: 1400, dur: 80, type: "sine", vol: 0.08 },
  ],
};

let audioCtx: AudioContext | null = null;
let audioUnlocked = false;

function getAudioContext(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

function unlockAudio(): void {
  if (audioUnlocked) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  audioUnlocked = true;
}

function playTone(type: SoundType): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const notes = SOUND_PATTERNS[type];
  if (!notes) return;
  const now = ctx.currentTime;

  let offset = 0;
  notes.forEach((note) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.type || "sine";
    osc.frequency.value = note.freq;
    const vol = note.vol ?? 0.15;
    const dur = note.dur / 1000;
    gain.gain.setValueAtTime(vol, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + offset);
    osc.stop(now + offset + dur);
    offset += dur;
  });
}

function vibrateDevice(): void {
  try {
    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }
  } catch {}
}

export function playSound(type: SoundType): void {
  if (!isSoundEnabled()) return;
  try {
    playTone(type);
  } catch {
    vibrateDevice();
  }
}

export function useSoundNotifications(userRole?: string) {
  const [enabled, setEnabled] = useState(() => initSoundDefault(userRole));
  const roleRef = useRef(userRole);

  useEffect(() => {
    if (userRole && userRole !== roleRef.current) {
      roleRef.current = userRole;
      initSoundDefault(userRole);
      setEnabled(isSoundEnabled());
    }
  }, [userRole]);

  useEffect(() => {
    const unlock = () => unlockAudio();
    document.addEventListener("click", unlock, { once: true });
    document.addEventListener("touchstart", unlock, { once: true });
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
    };
  }, []);

  const play = useCallback((type: SoundType) => {
    playSound(type);
  }, []);

  const toggle = useCallback((val?: boolean) => {
    const next = val !== undefined ? val : !isSoundEnabled();
    setSoundEnabled(next);
    setEnabled(next);
  }, []);

  return { play, enabled, toggle };
}
