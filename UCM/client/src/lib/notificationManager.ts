export type NotificationEvent =
  | "NEW_TRIP_ASSIGNED"
  | "TRIP_STATUS_CHANGED"
  | "MESSAGE_RECEIVED"
  | "SMART_PROMPT_CRITICAL"
  | "SMART_PROMPT_NORMAL"
  | "SHIFT_STARTED"
  | "SHIFT_ENDED";

interface SoundConfig {
  frequency: number;
  duration: number;
  type: OscillatorType;
  pattern?: number[];
}

const SOUND_MAP: Record<NotificationEvent, SoundConfig> = {
  NEW_TRIP_ASSIGNED: { frequency: 880, duration: 200, type: "sine", pattern: [200, 100, 200, 100, 300] },
  TRIP_STATUS_CHANGED: { frequency: 660, duration: 150, type: "sine", pattern: [150, 80, 150] },
  MESSAGE_RECEIVED: { frequency: 1200, duration: 100, type: "sine", pattern: [100, 50, 100] },
  SMART_PROMPT_CRITICAL: { frequency: 1000, duration: 250, type: "square", pattern: [250, 100, 250, 100, 400] },
  SMART_PROMPT_NORMAL: { frequency: 600, duration: 150, type: "sine", pattern: [150, 100, 150] },
  SHIFT_STARTED: { frequency: 523, duration: 200, type: "sine", pattern: [200, 50, 200] },
  SHIFT_ENDED: { frequency: 440, duration: 300, type: "sine", pattern: [300] },
};

type HapticStrength = "light" | "heavy";

const HAPTIC_MAP: Record<NotificationEvent, HapticStrength> = {
  NEW_TRIP_ASSIGNED: "heavy",
  TRIP_STATUS_CHANGED: "light",
  MESSAGE_RECEIVED: "light",
  SMART_PROMPT_CRITICAL: "heavy",
  SMART_PROMPT_NORMAL: "light",
  SHIFT_STARTED: "light",
  SHIFT_ENDED: "light",
};

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

async function playTone(config: SoundConfig): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;

  const pattern = config.pattern || [config.duration];
  const gainNode = ctx.createGain();
  gainNode.gain.value = 0.3;
  gainNode.connect(ctx.destination);

  let time = ctx.currentTime;
  for (let i = 0; i < pattern.length; i++) {
    const dur = pattern[i] / 1000;
    if (i % 2 === 0) {
      const osc = ctx.createOscillator();
      osc.type = config.type;
      osc.frequency.value = config.frequency;
      osc.connect(gainNode);
      osc.start(time);
      osc.stop(time + dur);
    }
    time += dur;
  }
}

function triggerHaptic(strength: HapticStrength): void {
  if (!navigator.vibrate) return;
  try {
    if (strength === "heavy") {
      navigator.vibrate([100, 50, 100, 50, 200]);
    } else {
      navigator.vibrate([50, 30, 50]);
    }
  } catch {}
}

export function initAudioContext(): void {
  getAudioContext();
}

interface NotificationPrefs {
  soundsOn: boolean;
  hapticsOn: boolean;
}

const defaultPrefs: NotificationPrefs = { soundsOn: true, hapticsOn: true };

export function notify(
  event: NotificationEvent,
  prefs: NotificationPrefs = defaultPrefs,
): void {
  if (prefs.soundsOn) {
    const soundConfig = SOUND_MAP[event];
    if (soundConfig) playTone(soundConfig).catch(() => {});
  }

  if (prefs.hapticsOn) {
    const hapticStrength = HAPTIC_MAP[event];
    if (hapticStrength) triggerHaptic(hapticStrength);
  }
}

export function enableSoundsOnUserGesture(): void {
  const handler = () => {
    initAudioContext();
    document.removeEventListener("click", handler);
    document.removeEventListener("touchstart", handler);
  };
  document.addEventListener("click", handler, { once: true });
  document.addEventListener("touchstart", handler, { once: true });
}
