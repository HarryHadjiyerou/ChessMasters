import { Howl, Howler } from 'howler';
import { MUSIC_RATE } from './gameMusic';

// All game audio is synthesised here at start-up (OfflineAudioContext -> WAV -> Howler), so no
// third-party sound files are needed and there is nothing to licence. Placeholder quality:
// clean, soft and cartoonish. Replace with recorded CC0 sounds later by swapping the src.

export type SoundName =
  | 'hover' | 'click' | 'move' | 'whoosh' | 'hit' | 'poof' | 'sparkle' | 'check' | 'victory' | 'draw' | 'start' | 'locked'
  | 'cheer' | 'clang' | 'badge' | 'buzz' | 'warn' | 'wind';

const RATE = 22050;

type Render = (ctx: OfflineAudioContext, out: AudioNode) => void;

function env(g: GainNode, t: number, a: number, peak: number, d: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function tone(ctx: OfflineAudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, a: number, d: number, peak: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
  env(g, t, a, peak, d);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + a + d + 0.05);
}

function noise(ctx: OfflineAudioContext, out: AudioNode, t: number, dur: number, peak: number, filter: BiquadFilterType, f0: number, f1 = f0, a = 0.005) {
  const len = Math.ceil(dur * RATE);
  const buf = ctx.createBuffer(1, len, RATE);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  env(g, t, a, peak, dur - a);
  src.connect(f).connect(g).connect(out);
  src.start(t);
}

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

const SOUNDS: Record<SoundName, { dur: number; render: Render }> = {
  hover: { dur: 0.08, render: (c, o) => tone(c, o, 'sine', 1400, 1500, 0, 0.004, 0.05, 0.12) },
  click: { dur: 0.15, render: (c, o) => { tone(c, o, 'triangle', 700, 320, 0, 0.003, 0.09, 0.5); noise(c, o, 0, 0.04, 0.15, 'bandpass', 2500); } },
  locked: { dur: 0.25, render: (c, o) => { tone(c, o, 'square', 220, 180, 0, 0.005, 0.08, 0.12); tone(c, o, 'square', 180, 150, 0.1, 0.005, 0.1, 0.12); } },
  move: { dur: 0.2, render: (c, o) => { noise(c, o, 0, 0.06, 0.5, 'bandpass', 1800, 900); tone(c, o, 'sine', 260, 180, 0, 0.002, 0.12, 0.45); } },
  // Gust of wind for the arena weather (sand blast, blizzard, breeze).
  wind: { dur: 3.0, render: (c, o) => { noise(c, o, 0, 2.9, 0.3, 'bandpass', 300, 1100, 1.1); noise(c, o, 0.3, 2.4, 0.12, 'highpass', 2500, 4000, 0.9); } },
  whoosh: { dur: 0.35, render: (c, o) => noise(c, o, 0, 0.33, 0.35, 'bandpass', 400, 2400, 0.12) },
  hit: { dur: 0.3, render: (c, o) => { tone(c, o, 'sine', 160, 55, 0, 0.003, 0.22, 0.9); noise(c, o, 0, 0.08, 0.5, 'lowpass', 3000, 600); tone(c, o, 'triangle', 900, 500, 0, 0.002, 0.05, 0.2); } },
  poof: { dur: 0.6, render: (c, o) => { noise(c, o, 0, 0.5, 0.55, 'lowpass', 2200, 300, 0.02); tone(c, o, 'sine', 500, 1100, 0.02, 0.01, 0.25, 0.15); } },
  sparkle: { dur: 0.9, render: (c, o) => { [84, 88, 91, 96, 100].forEach((n, i) => tone(c, o, 'sine', NOTE(n), NOTE(n), i * 0.07, 0.005, 0.4, 0.18)); } },
  check: { dur: 1.0, render: (c, o) => { tone(c, o, 'sine', 880, 880, 0, 0.005, 0.8, 0.35); tone(c, o, 'sine', 1320, 1320, 0, 0.005, 0.6, 0.15); tone(c, o, 'sine', 1760, 1760, 0.12, 0.005, 0.5, 0.12); } },
  start: { dur: 0.9, render: (c, o) => { [67, 72, 76].forEach((n, i) => tone(c, o, 'triangle', NOTE(n), NOTE(n), i * 0.12, 0.01, 0.35, 0.3)); } },
  victory: {
    dur: 2.0, render: (c, o) => {
      const notes = [60, 64, 67, 72, 67, 72];
      const times = [0, 0.15, 0.3, 0.45, 0.75, 0.9];
      notes.forEach((n, i) => {
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400; f.connect(o);
        tone(c, f, 'sawtooth', NOTE(n), NOTE(n), times[i], 0.02, i === notes.length - 1 ? 0.9 : 0.22, 0.22);
        tone(c, o, 'sine', NOTE(n - 12), NOTE(n - 12), times[i], 0.02, 0.3, 0.2);
      });
    },
  },
  draw: { dur: 1.2, render: (c, o) => { tone(c, o, 'triangle', NOTE(67), NOTE(67), 0, 0.02, 0.4, 0.3); tone(c, o, 'triangle', NOTE(64), NOTE(64), 0.35, 0.02, 0.7, 0.3); } },
  // Little crowd cheer: "yay" voices (formant-filtered saws gliding up), claps and whistles.
  cheer: {
    dur: 1.8, render: (c, o) => {
      for (let i = 0; i < 9; i++) {
        const t = 0.02 + Math.random() * 0.12;
        const f0 = 230 + Math.random() * 220;
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.linearRampToValueAtTime(f0 * 1.35, t + 0.25);
        osc.frequency.linearRampToValueAtTime(f0 * 1.15, t + 1.1);
        const formant = c.createBiquadFilter();
        formant.type = 'bandpass'; formant.Q.value = 4;
        formant.frequency.setValueAtTime(700, t);
        formant.frequency.linearRampToValueAtTime(1500, t + 0.3);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2 + Math.random() * 0.3);
        osc.connect(formant).connect(g).connect(o);
        osc.start(t); osc.stop(t + 1.6);
      }
      for (let i = 0; i < 26; i++) noise(c, o, 0.05 + i * 0.05 + Math.random() * 0.03, 0.04, 0.22 * (1 - i / 30), 'bandpass', 1600 + Math.random() * 1400, 1200);
      tone(c, o, 'sine', 1900, 2700, 0.1, 0.02, 0.3, 0.06);
      tone(c, o, 'sine', 2100, 2900, 0.55, 0.02, 0.35, 0.05);
    },
  },
  // Clang plus a sad "wah-wah": the opposite of a cheer, but still funny.
  clang: {
    dur: 1.7, render: (c, o) => {
      [523, 1307, 2131, 3057].forEach((f, i) => tone(c, o, 'sine', f, f * 0.995, 0, 0.002, 0.9 - i * 0.18, 0.22 / (i + 1)));
      noise(c, o, 0, 0.06, 0.3, 'highpass', 3000);
      const wah = (t: number, f0: number, f1: number, d: number) => {
        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.linearRampToValueAtTime(f1, t + d);
        const lfo = c.createOscillator(); lfo.frequency.value = 6;
        const lg = c.createGain(); lg.gain.value = 4;
        lfo.connect(lg).connect(osc.frequency);
        const lp = c.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(1300, t + 0.12); lp.frequency.linearRampToValueAtTime(500, t + d);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        osc.connect(lp).connect(g).connect(o);
        osc.start(t); lfo.start(t); osc.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
      };
      wah(0.45, 233, 230, 0.32);
      wah(0.8, 220, 196, 0.8);
    },
  },
  // Badge fanfare: quick rising trumpet notes and a sparkle.
  badge: {
    dur: 1.4, render: (c, o) => {
      [72, 76, 79, 84].forEach((n, i) => {
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000; f.connect(o);
        tone(c, f, 'sawtooth', NOTE(n), NOTE(n), i * 0.09, 0.01, i === 3 ? 0.6 : 0.12, 0.16);
      });
      [88, 91, 96].forEach((n, i) => tone(c, o, 'sine', NOTE(n), NOTE(n), 0.4 + i * 0.06, 0.004, 0.4, 0.08));
    },
  },
  buzz: { dur: 0.35, render: (c, o) => { tone(c, o, 'square', 150, 140, 0, 0.004, 0.09, 0.14); tone(c, o, 'square', 120, 110, 0.13, 0.004, 0.14, 0.14); } },
  warn: { dur: 0.7, render: (c, o) => { [0, 0.28].forEach((t) => { tone(c, o, 'triangle', 988, 988, t, 0.005, 0.12, 0.25); tone(c, o, 'triangle', 740, 740, t + 0.13, 0.005, 0.12, 0.25); }); } },
};

/** Calm garden loop: soft pad chords and a gentle harp-like arpeggio, 16 bars of 1 s. */
function renderMusic(c: OfflineAudioContext, o: AudioNode): void {
  const chords = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 67]];
  const master = c.createGain();
  master.gain.value = 0.5;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  master.connect(lp).connect(o);
  for (let bar = 0; bar < 16; bar++) {
    const chord = chords[Math.floor(bar / 2) % 4];
    const t = bar;
    if (bar % 2 === 0) for (const n of chord) tone(c, master, 'triangle', NOTE(n - 12), NOTE(n - 12), t, 0.6, 1.5, 0.05);
    for (let i = 0; i < 4; i++) {
      const n = chord[(i + bar) % 4] + 12;
      tone(c, master, 'sine', NOTE(n), NOTE(n), t + i * 0.25, 0.005, 0.7, 0.07);
    }
  }
}

function toWav(data: Float32Array, rate = RATE): Blob {
  const out = new DataView(new ArrayBuffer(44 + data.length * 2));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + data.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 0x7fff, true);
  return new Blob([out], { type: 'audio/wav' });
}

async function render(dur: number, fn: Render): Promise<string> {
  const ctx = new OfflineAudioContext(1, Math.ceil(dur * RATE), RATE);
  fn(ctx, ctx.destination);
  return URL.createObjectURL(toWav((await ctx.startRendering()).getChannelData(0)));
}

export type Track = 'menu' | 'game';

class SoundBank {
  private howls = new Map<SoundName, Howl>();
  private tracks = new Map<Track, Howl>();
  private current: Track | null = null;
  private sfxVolume = 0.8;
  private musicVolume = 0.4;
  private wanted: Track | null = null;
  ready = false;

  /** Set before init() to run silently (e.g. automated tests: ?mute). */
  disabled = false;

  async init(): Promise<void> {
    if (this.disabled || this.ready || typeof OfflineAudioContext === 'undefined') return;
    try {
      const entries = Object.entries(SOUNDS) as [SoundName, { dur: number; render: Render }][];
      const urls = await Promise.all(entries.map(([, s]) => render(s.dur, s.render)));
      entries.forEach(([name], i) => this.howls.set(name, new Howl({ src: [urls[i]], format: ['wav'], volume: this.sfxVolume })));
      const musicUrl = await render(16, renderMusic);
      this.tracks.set('menu', new Howl({ src: [musicUrl], format: ['wav'], loop: true, volume: 0 }));
      this.ready = true;
      if (this.wanted) this.playMusic(this.wanted);
      // The game track takes a moment to synthesise, so it is built after loading finishes.
      const worker = new Worker(new URL('./musicWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<Float32Array>) => {
        worker.terminate();
        const url = URL.createObjectURL(toWav(e.data, MUSIC_RATE));
        this.tracks.set('game', new Howl({ src: [url], format: ['wav'], loop: true, volume: 0 }));
        if (this.wanted === 'game') this.playMusic('game');
      };
    } catch (err) {
      console.warn('Audio unavailable', err);
    }
  }

  play(name: SoundName, volume = 1): void {
    const h = this.howls.get(name);
    if (!h || this.sfxVolume <= 0) return;
    const id = h.play();
    h.volume(this.sfxVolume * volume, id);
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    const h = this.current ? this.tracks.get(this.current) : null;
    if (h?.playing()) h.volume(this.trackVolume(this.current!));
  }

  private ducked = false;
  private trackVolume(t: Track): number { return this.musicVolume * (t === 'game' ? 0.3 : 0.4) * (this.ducked ? 0.35 : 1); }

  /** Lowers the music while the coach is speaking, and brings it back afterwards. */
  duckMusic(on: boolean): void {
    if (this.ducked === on) return;
    this.ducked = on;
    const h = this.current ? this.tracks.get(this.current) : null;
    if (h?.playing()) h.fade(h.volume(), this.trackVolume(this.current!), on ? 250 : 600);
  }

  /** Cross-fades to a music track (menu: calm garden loop; game: upbeat classical chiptune). */
  playMusic(track: Track = 'menu'): void {
    this.wanted = track;
    const next = this.tracks.get(track);
    if (!next) return; // not ready yet: starts when it is
    if (this.current === track && next.playing()) return;
    this.fadeOut();
    this.current = track;
    next.volume(0);
    next.play();
    next.fade(0, this.trackVolume(track), 1200);
  }

  stopMusic(): void {
    this.wanted = null;
    this.fadeOut();
    this.current = null;
  }

  private fadeOut(): void {
    const h = this.current ? this.tracks.get(this.current) : null;
    if (h?.playing()) {
      h.fade(h.volume(), 0, 700);
      setTimeout(() => { if (this.tracks.get(this.current!) !== h) h.stop(); }, 750);
    }
  }

  mute(on: boolean): void { Howler.mute(on); }

  /** For tests: which effects and tracks are ready. */
  status(): { effects: string[]; tracks: string[]; playing: Track | null } {
    return { effects: [...this.howls.keys()], tracks: [...this.tracks.keys()], playing: this.current };
  }
}

export const sound = new SoundBank();
