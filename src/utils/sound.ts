let context: AudioContext | undefined;

function getContext(enabled = true): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    context ??= new AudioCtx();
    if (context.state === 'suspended') {
      void context.resume();
    }
    return context;
  } catch {
    return null;
  }
}

export function playDiceSound(enabled = true) {
  const ctx = getContext(enabled);
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    for (const t of [0, 0.06]) {
      const length = Math.floor(ctx.sampleRate * 0.03);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      source.buffer = buffer;
      filter.type = 'bandpass';
      filter.frequency.value = 1200;
      gain.gain.setValueAtTime(0.11, now + t);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.03);
      source.connect(filter).connect(gain).connect(ctx.destination);
      source.start(now + t);
      source.stop(now + t + 0.031);
    }
    for (const [t, f] of [[0.31, 160], [0.37, 130]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.08, now + t);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.09);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.1);
    }
  } catch {}
}

/** Crisp pleasant two-tone chime (523Hz C5 to 659Hz E5) */
export function playBuySound(enabled = true) {
  const ctx = getContext(enabled);
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const notes: [number, number, number][] = [
      [0, 523.25, 0.16],
      [0.08, 659.25, 0.26],
    ];
    for (const [offset, freq, dur] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + offset);
      gain.gain.setValueAtTime(0.14, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + dur + 0.01);
    }
  } catch {}
}

/** Soft descending tone (440Hz A4 to 293Hz D4) */
export function playRentSound(enabled = true) {
  const ctx = getContext(enabled);
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(293.66, now + 0.22);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch {}
}

/** Low dramatic thud (80Hz with quick exponential decay) */
export function playJailSound(enabled = true) {
  const ctx = getContext(enabled);
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(36, now + 0.25);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  } catch {}
}

/** Triumphant ascending mini-fanfare (C5, E5, G5, C6) */
export function playWinSound(enabled = true) {
  const ctx = getContext(enabled);
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const fanfareNotes: [number, number, number][] = [
      [0, 523.25, 0.12],
      [0.09, 659.25, 0.12],
      [0.18, 783.99, 0.14],
      [0.30, 1046.50, 0.42],
    ];
    for (const [offset, freq, dur] of fanfareNotes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + offset);
      gain.gain.setValueAtTime(0.15, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + dur + 0.01);
    }
  } catch {}
}
