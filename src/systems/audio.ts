// All sound is synthesized with the Web Audio API (oscillators/noise + envelopes) — no
// external audio files, so there's nothing to license or fetch. Must be initialized from a
// user gesture (browser autoplay policy), so the game calls initAudio() as it starts from the play button.
let ctx: AudioContext | null = null;
let engineOsc: OscillatorNode | null = null;
let engineGain: GainNode | null = null;
let engineFilter: BiquadFilterNode | null = null;
let lastChatterTime = -999;
let lastIndicatorEdge = false;

export function initAudio(): void {
  if (ctx) return;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return; // unsupported browser — sound is a nice-to-have, never block gameplay
  ctx = new AC();
  // The game arrives here after its code has been fetched, which can take longer than the browser keeps the click's
  // user activation alive: if the context was left suspended, the first key or click wakes it.
  if (ctx.state === 'suspended') {
    const wake = (): void => { void ctx?.resume(); };
    window.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });
  }

  // Persistent low engine drone; frequency/gain are pushed each frame by updateEngineSound().
  engineOsc = ctx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 350;
  engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engineOsc.connect(engineFilter).connect(engineGain).connect(ctx.destination);
  engineOsc.frequency.value = 60;
  engineOsc.start();
}

// While the game is paused nothing should be making sound (or costing the audio thread anything).
export function suspendAudio(): void {
  if (ctx?.state === 'running') void ctx.suspend();
}

export function resumeAudio(): void {
  if (ctx?.state === 'suspended') void ctx.resume();
}

function noiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
  const size = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function updateEngineSound(speedKmh: number, throttle: number): void {
  if (!ctx || !engineOsc || !engineGain || !engineFilter) return;
  const now = ctx.currentTime;
  const rpmFreq = 55 + Math.min(speedKmh, 120) * 2.1 + throttle * 40;
  engineOsc.frequency.setTargetAtTime(rpmFreq, now, 0.08);
  const targetGain = 0.05 + throttle * 0.05 + Math.min(speedKmh / 100, 1) * 0.03;
  engineGain.gain.setTargetAtTime(targetGain, now, 0.15);
  engineFilter.frequency.setTargetAtTime(300 + throttle * 500, now, 0.15);
}

export function playHonk(): void {
  if (!ctx) return;
  const audio = ctx; // (a local const keeps the null check valid inside the callback)
  const now = ctx.currentTime;
  [330, 415].forEach((freq, i) => {
    const osc = audio.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.03);
    gain.gain.setValueAtTime(0.16, now + 0.32);
    gain.gain.linearRampToValueAtTime(0, now + 0.42);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + i * 0.01);
    osc.stop(now + 0.45);
  });
}

export function playCrash(intensity = 1): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.5);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  const gain = ctx.createGain();
  const peak = Math.min(0.55, 0.2 + intensity * 0.1);
  gain.gain.setValueAtTime(peak, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(now);

  // low thud under the noise burst
  const thud = ctx.createOscillator();
  thud.type = 'sine'; thud.frequency.setValueAtTime(90, now);
  thud.frequency.exponentialRampToValueAtTime(30, now + 0.25);
  const thudGain = ctx.createGain();
  thudGain.gain.setValueAtTime(peak * 0.9, now);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  thud.connect(thudGain).connect(ctx.destination);
  thud.start(now); thud.stop(now + 0.3);
}

export function playBrakeScreech(): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.35);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1800, now);
  filter.frequency.exponentialRampToValueAtTime(2600, now + 0.3);
  filter.Q.value = 8;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.35);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(now);
}

export function playIndicatorTick(): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'square'; osc.frequency.value = 1200;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now); osc.stop(now + 0.06);
}

// Call every frame with the current blink state; fires a tick exactly on each on/off edge.
export function updateIndicatorSound(blinkActive: boolean): void {
  if (blinkActive !== lastIndicatorEdge) { lastIndicatorEdge = blinkActive; if (ctx) playIndicatorTick(); }
}

export function playPedestrianChatter(): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  if (now - lastChatterTime < 2.5) return;
  lastChatterTime = now;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, 0.18);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 850 + Math.random() * 500;
  filter.Q.value = 4;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.05, now + 0.03);
  gain.gain.linearRampToValueAtTime(0, now + 0.16);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(now);
}
