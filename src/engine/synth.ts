import type { SoundEvent } from './audio';

/**
 * Procedural sound effects and an ambient music loop built on the Web Audio API. Nothing here
 * needs an asset file; the audio bus falls back to this synth for any event without an .ogg.
 */
export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer = 0;
  private nextNoteAt = 0;
  private melodyIdx = 3;
  private beat = 0;
  private drone: OscillatorNode[] = [];
  private gestureSeen = false;

  /** A real user gesture happened: sounds may be scheduled even while resume() is pending. */
  markGesture() {
    this.gestureSeen = true;
  }

  /** Must be called from a user gesture at least once; safe to call repeatedly. */
  ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.master);
      return this.ctx;
    } catch {
      return null;
    }
  }
  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  // ------------------------------------------------------------------ primitives
  private tone(
    freq: number,
    type: OscillatorType,
    start: number,
    dur: number,
    vol: number,
    opts: {
      attack?: number;
      decay?: number;
      slideTo?: number;
      vibrato?: number;
      lowpass?: number;
    } = {},
  ) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, start + dur);
    const g = ctx.createGain();
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + a);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur + (opts.decay ?? 0));
    let out: AudioNode = g;
    if (opts.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opts.lowpass;
      g.connect(lp);
      out = lp;
    }
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 6;
      const lg = ctx.createGain();
      lg.gain.value = opts.vibrato;
      lfo.connect(lg);
      lg.connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + dur + (opts.decay ?? 0) + 0.05);
    }
    osc.connect(g);
    out.connect(this.master!);
    osc.start(start);
    osc.stop(start + dur + (opts.decay ?? 0) + 0.05);
  }

  private noise(
    start: number,
    dur: number,
    vol: number,
    opts: { bandpass?: number; sweepTo?: number; q?: number } = {},
  ) {
    const ctx = this.ctx!;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    let out: AudioNode = g;
    if (opts.bandpass) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = opts.q ?? 1.5;
      bp.frequency.setValueAtTime(opts.bandpass, start);
      if (opts.sweepTo) bp.frequency.exponentialRampToValueAtTime(opts.sweepTo, start + dur);
      g.connect(bp);
      out = bp;
    }
    src.connect(g);
    out.connect(this.master!);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  // ------------------------------------------------------------------ effects
  play(name: SoundEvent, vol: number) {
    const ctx = this.ensure();
    if (!ctx || vol <= 0 || (ctx.state !== 'running' && !this.gestureSeen)) return;
    const t = ctx.currentTime + 0.01;
    const v = Math.min(1, vol) * 0.5;
    switch (name) {
      case 'ui.click':
        this.tone(1400, 'square', t, 0.03, v * 0.25, { decay: 0.02 });
        this.noise(t, 0.03, v * 0.15, { bandpass: 3000 });
        break;
      case 'ui.open':
        this.tone(520, 'triangle', t, 0.06, v * 0.4);
        this.tone(780, 'triangle', t + 0.06, 0.09, v * 0.4);
        break;
      case 'ui.close':
        this.tone(780, 'triangle', t, 0.06, v * 0.35);
        this.tone(520, 'triangle', t + 0.06, 0.09, v * 0.35);
        break;
      case 'build.place':
        this.tone(110, 'sine', t, 0.12, v * 0.9, { slideTo: 60, decay: 0.05 });
        this.noise(t, 0.05, v * 0.4, { bandpass: 1200 });
        break;
      case 'build.remove':
        this.tone(320, 'sawtooth', t, 0.16, v * 0.35, { slideTo: 90, lowpass: 900 });
        this.noise(t + 0.02, 0.12, v * 0.3, { bandpass: 700, sweepTo: 200 });
        break;
      case 'build.invalid':
        this.tone(95, 'square', t, 0.1, v * 0.35, { lowpass: 500 });
        break;
      case 'station.upgrade':
        [440, 554, 659, 880].forEach((f, i) =>
          this.tone(f, 'triangle', t + i * 0.09, 0.14, v * 0.45, { decay: 0.1 }),
        );
        this.noise(t, 0.25, v * 0.15, { bandpass: 2500, sweepTo: 600 });
        break;
      case 'train.dispatch':
        this.tone(660, 'sine', t, 0.25, v * 0.5, { vibrato: 8, decay: 0.1 });
        this.tone(880, 'sine', t + 0.02, 0.23, v * 0.35, { vibrato: 8, decay: 0.1 });
        this.noise(t, 0.3, v * 0.12, { bandpass: 1800, q: 4 });
        break;
      case 'train.whistle':
        this.tone(587, 'sine', t, 0.5, v * 0.5, { vibrato: 10, attack: 0.04, decay: 0.15 });
        this.tone(880, 'sine', t, 0.5, v * 0.3, { vibrato: 12, attack: 0.04, decay: 0.15 });
        this.noise(t, 0.55, v * 0.12, { bandpass: 2200, q: 5 });
        break;
      case 'train.arrive':
        this.tone(880, 'sine', t, 0.5, v * 0.5, { decay: 0.4 });
        this.tone(1320, 'sine', t, 0.4, v * 0.2, { decay: 0.4 });
        this.tone(880, 'sine', t + 0.45, 0.5, v * 0.4, { decay: 0.4 });
        break;
      case 'contract.accept':
        this.tone(150, 'sine', t, 0.08, v * 0.8, { slideTo: 80 });
        this.tone(1200, 'square', t + 0.08, 0.02, v * 0.2);
        break;
      case 'contract.done':
        [523, 659, 784, 1047].forEach((f, i) =>
          this.tone(f, 'triangle', t + i * 0.1, 0.18, v * 0.5, { decay: 0.2 }),
        );
        break;
      case 'contract.fail':
        [392, 349, 311, 262].forEach((f, i) =>
          this.tone(f, 'triangle', t + i * 0.13, 0.2, v * 0.45, { decay: 0.15, lowpass: 1200 }),
        );
        break;
      case 'gacha.pull':
        this.noise(t, 0.45, v * 0.5, { bandpass: 300, sweepTo: 3200, q: 2 });
        this.tone(220, 'sine', t, 0.45, v * 0.2, { slideTo: 880 });
        break;
      case 'gacha.reveal':
        this.tone(1200, 'triangle', t, 0.04, v * 0.35, { decay: 0.03 });
        this.tone(1800, 'triangle', t + 0.03, 0.05, v * 0.25, { decay: 0.03 });
        break;
      case 'gacha.ssr':
        [523, 659, 784, 1047, 1319].forEach((f, i) => {
          this.tone(f, 'triangle', t + i * 0.08, 0.35, v * 0.5, { decay: 0.3 });
          this.tone(f * 2, 'sine', t + i * 0.08, 0.3, v * 0.15, { decay: 0.3 });
        });
        this.noise(t + 0.3, 0.6, v * 0.2, { bandpass: 4000, sweepTo: 800 });
        break;
      case 'tier.up':
        [262, 330, 392, 523].forEach((f) =>
          this.tone(f, 'triangle', t, 0.9, v * 0.3, { attack: 0.2, decay: 0.5 }),
        );
        this.tone(1047, 'sine', t + 0.4, 0.6, v * 0.25, { attack: 0.1, decay: 0.4 });
        break;
    }
  }

  // ------------------------------------------------------------------ music
  /** Slow modal loop: two-note drone plus a wandering pentatonic melody. */
  startMusic() {
    const ctx = this.ensure();
    if (!ctx || this.musicTimer) return;
    const g = this.musicGain!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    lp.connect(g);
    for (const [f, vol] of [
      [73.4, 0.5],
      [110, 0.35],
      [146.8, 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = vol;
      o.connect(og);
      og.connect(lp);
      o.start();
      this.drone.push(o);
    }
    this.nextNoteAt = ctx.currentTime + 0.5;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 200);
  }
  private scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const SCALE = [146.8, 174.6, 196, 220, 261.6, 293.7, 349.2, 392];
    while (this.nextNoteAt < ctx.currentTime + 0.6) {
      const t = this.nextNoteAt;
      const beat = this.beat++;
      // melody on most beats, rests keep it sparse
      if (Math.random() < 0.72) {
        const stepR = Math.random();
        this.melodyIdx +=
          stepR < 0.3 ? -1 : stepR < 0.6 ? 1 : stepR < 0.7 ? 2 : stepR < 0.8 ? -2 : 0;
        this.melodyIdx = Math.max(0, Math.min(SCALE.length - 1, this.melodyIdx));
        const f = SCALE[this.melodyIdx];
        this.musicVoice(f, t, 1.1 + Math.random() * 0.8, 0.16);
        if (Math.random() < 0.25) this.musicVoice(f * 1.5, t + 0.05, 0.9, 0.06);
      }
      // low pulse every 4 beats
      if (beat % 4 === 0)
        this.musicVoice(73.4 * (beat % 8 === 0 ? 1 : 1.5), t, 1.6, 0.12, 'triangle');
      this.nextNoteAt += 1.4;
    }
  }
  private musicVoice(
    freq: number,
    start: number,
    dur: number,
    vol: number,
    type: OscillatorType = 'triangle',
  ) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    o.connect(g);
    g.connect(lp);
    lp.connect(this.musicGain!);
    o.start(start);
    o.stop(start + dur + 0.05);
  }
  setMusicVolume(v: number) {
    if (!this.ctx || !this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, v)) * 0.6,
      this.ctx.currentTime,
      0.3,
    );
  }
  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = 0;
    for (const o of this.drone) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    this.drone = [];
  }
}
