/** Quiet continuous weather beds, sparse birds by day and crickets after dusk. */
export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: GainNode | null = null;
  private rain: GainNode | null = null;
  private nextCall = 0;
  private volume = 0;
  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (this.ctx && this.master)
        this.master.gain.setTargetAtTime(
          document.hidden ? 0 : this.volume,
          this.ctx.currentTime,
          0.15,
        );
    });
  }
  private init(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 8, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const bed = (type: BiquadFilterType, frequency: number) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = 0.35;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master!);
      source.start();
      return gain;
    };
    this.wind = bed('lowpass', 430);
    this.rain = bed('bandpass', 2400);
  }
  update(ctx: AudioContext, volume: number, rain: number, night: number) {
    if (!this.ctx) this.init(ctx);
    this.volume = volume;
    const now = ctx.currentTime;
    this.master!.gain.setTargetAtTime(document.hidden ? 0 : volume, now, 0.2);
    this.wind!.gain.setTargetAtTime(0.035 + 0.012 * Math.sin(now * 0.14), now, 1.2);
    this.rain!.gain.setTargetAtTime(rain * 0.24, now, 1.5);
    if (document.hidden || volume <= 0 || now < this.nextCall || rain > 0.35) return;
    this.nextCall = now + (night > 0.5 ? 5 : 9) + Math.random() * 12;
    for (let i = 0; i < (night > 0.5 ? 3 : 2); i++) {
      const start = now + i * 0.16,
        length = night > 0.5 ? 0.07 : 0.11;
      const osc = ctx.createOscillator(),
        gain = ctx.createGain(),
        pan = ctx.createStereoPanner();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(night > 0.5 ? 3500 : 1900 + Math.random() * 600, start);
      osc.frequency.exponentialRampToValueAtTime(night > 0.5 ? 3200 : 3000, start + length);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(night > 0.5 ? 0.012 : 0.026, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      pan.pan.value = Math.sin(now) * 0.65;
      osc.connect(gain);
      gain.connect(pan);
      pan.connect(this.master!);
      osc.start(start);
      osc.stop(start + length + 0.02);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        pan.disconnect();
      };
    }
  }
}
