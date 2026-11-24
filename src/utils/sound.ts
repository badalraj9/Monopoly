let context: AudioContext | undefined;

/** Pre-cached white-noise buffer, allocated once and reused on every dice roll. */
let cachedNoiseBuffer: AudioBuffer | null = null;

/** Shared bandpass filter for dice clatter, reused across rolls. */
let cachedDiceFilter: BiquadFilterNode | null = null;

/** Shared master gain node so we don't recreate one per sound. */
let masterGain: GainNode | undefined;

function getContext(enabled = true): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    if (!context) {
      context = new AudioCtx();
      masterGain = context.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(context.destination);

      // Pre-allocate noise buffer and filter at context initialization
      getNoiseBuffer(context);
      getDiceFilter(context);
    }
    return context;
  } catch {
    return null;
  }
}

function getMasterGain(): GainNode {
  return masterGain!;
}

function getDiceFilter(ctx: AudioContext): BiquadFilterNode {
  if (!cachedDiceFilter || cachedDiceFilter.context !== ctx) {
    cachedDiceFilter = ctx.createBiquadFilter();
    cachedDiceFilter.type = 'bandpass';
    cachedDiceFilter.frequency.value = 1200;
  }
  return cachedDiceFilter;
}

/**
 * Pre-allocated 30ms white-noise buffer with linear decay envelope baked in.
 * Avoids allocating and filling an AudioBuffer on the main thread during gameplay.
 */
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (cachedNoiseBuffer && cachedNoiseBuffer.sampleRate === ctx.sampleRate) {
    return cachedNoiseBuffer;
  }
  const length = Math.floor(ctx.sampleRate * 0.03);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  cachedNoiseBuffer = buffer;
  return buffer;
}

export async function playDiceSound(enabled = true) {
  const ctx = getContext(enabled);
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    const now = ctx.currentTime;
    const dest = getMasterGain();
    const noiseBuffer = getNoiseBuffer(ctx);
    const filter = getDiceFilter(ctx);

    // Single shared gain node for both noise bursts
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    filter.disconnect();
    filter.connect(noiseGain);
    noiseGain.connect(dest);

    for (const t of [0, 0.06]) {
      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer;
      source.connect(filter);
      noiseGain.gain.setValueAtTime(0.11, now + t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.03);
      source.start(now + t);
      source.stop(now + t + 0.031);
    }

    // Single shared gain node for both low-frequency thud oscillators
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.001, now);
    thudGain.connect(dest);

    for (const [t, f] of [[0.31, 160], [0.37, 130]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      thudGain.gain.setValueAtTime(0.08, now + t);
      thudGain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.09);
      osc.connect(thudGain);
      osc.start(now + t);
      osc.stop(now + t + 0.1);
    }
  } catch {}
}

/** Crisp pleasant two-tone chime (523Hz C5 to 659Hz E5) */
export async function playBuySound(enabled = true) {
  const ctx = getContext(enabled);
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
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
export async function playRentSound(enabled = true) {
  const ctx = getContext(enabled);
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
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
export async function playJailSound(enabled = true) {
  const ctx = getContext(enabled);
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
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
export async function playWinSound(enabled = true) {
  const ctx = getContext(enabled);
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
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
