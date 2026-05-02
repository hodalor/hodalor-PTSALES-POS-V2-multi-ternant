const CHAT_SOUND_PRESETS = {
  soft: {
    volume: 0.045,
    tones: [
      { freq: 740, start: 0, duration: 0.16, type: 'sine' },
      { freq: 988, start: 0.15, duration: 0.18, type: 'sine' }
    ]
  },
  classic: {
    volume: 0.08,
    tones: [
      { freq: 880, start: 0, duration: 0.18, type: 'sine' },
      { freq: 1174, start: 0.16, duration: 0.2, type: 'sine' }
    ]
  },
  bright: {
    volume: 0.1,
    tones: [
      { freq: 1046, start: 0, duration: 0.12, type: 'triangle' },
      { freq: 1318, start: 0.12, duration: 0.14, type: 'triangle' },
      { freq: 1567, start: 0.25, duration: 0.2, type: 'triangle' }
    ]
  }
};

export const CHAT_SOUND_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'soft', label: 'Soft' },
  { value: 'classic', label: 'Classic' },
  { value: 'bright', label: 'Bright' }
];

let ctx = null;

function getContext() {
  const AudioCtx = typeof window !== 'undefined'
    ? (window.AudioContext || window.webkitAudioContext || null)
    : null;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

export async function unlockChatSound() {
  const audio = getContext();
  if (!audio) return false;
  try {
    if (audio.state === 'suspended') await audio.resume();
    return audio.state === 'running';
  } catch {
    return false;
  }
}

export async function playChatSound(soundKey = 'classic') {
  const audio = getContext();
  if (!audio) return false;
  try {
    if (audio.state === 'suspended') await audio.resume();
    const mode = String(soundKey || 'classic').toLowerCase();
    if (mode === 'off') return true;
    const preset = CHAT_SOUND_PRESETS[mode] || CHAT_SOUND_PRESETS.classic;
    const now = audio.currentTime;
    const master = audio.createGain();
    master.connect(audio.destination);
    const endAt = Math.max(...preset.tones.map((tone) => tone.start + tone.duration), 0.35);
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(preset.volume, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + endAt + 0.15);
    preset.tones.forEach((tone) => {
      const osc = audio.createOscillator();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(tone.freq, now + tone.start);
      osc.connect(master);
      osc.start(now + tone.start);
      osc.stop(now + tone.start + tone.duration);
    });
    return true;
  } catch {
    return false;
  }
}
