import { useCallback, useEffect, useRef, useState } from "react";

type SoundType = "trip_assigned" | "trip_completed" | "notification";

const STORAGE_KEY = "ucm_sound_enabled";

function isSoundEnabled(): boolean {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    return val !== "false";
  } catch {
    return true;
  }
}

function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {}
}

const FREQUENCIES: Record<SoundType, number[]> = {
  trip_assigned: [587, 784, 880],
  trip_completed: [880, 784, 659],
  notification: [659, 880],
};

const DURATIONS: Record<SoundType, number> = {
  trip_assigned: 120,
  trip_completed: 100,
  notification: 80,
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

  const freqs = FREQUENCIES[type];
  const dur = DURATIONS[type] / 1000;
  const now = ctx.currentTime;

  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, now + i * dur);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (i + 1) * dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * dur);
    osc.stop(now + (i + 1) * dur);
  });
}

function vibrateDevice(): void {
  try {
    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }
  } catch {}
}

function playSound(type: SoundType): void {
  if (!isSoundEnabled()) return;
  try {
    playTone(type);
  } catch {
    vibrateDevice();
  }
}

export function useSoundNotifications() {
  const [enabled, setEnabled] = useState(isSoundEnabled);

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

export { isSoundEnabled, setSoundEnabled, playSound };
