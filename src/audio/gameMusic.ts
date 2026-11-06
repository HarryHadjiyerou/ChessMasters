// In-game music: an original, upbeat piece in classical style (C major, 152 bpm, form A A' B A'),
// arranged like a chiptune: square-wave lead, harpsichord Alberti bass, oom-pah bass line,
// bell doubling on the repeat, light kick/snare/hat. Synthesised sample by sample (no audio
// files). Loops seamlessly: anything past the end wraps to the start.

export const MUSIC_RATE = 32000;
const BPM = 152;
const SIXTEENTH = 60 / BPM / 4;
const BAR = SIXTEENTH * 16;

// Melody, bar by bar: "NOTE:sixteenths" ('R' = rest).
const A = [
  'C5:2 E5:2 G5:2 E5:2 C6:4 G5:4',
  'B5:2 A5:2 G5:2 F5:2 D5:4 G4:4',
  'A4:2 C5:2 E5:2 A5:2 G5:2 F5:2 E5:2 D5:2',
  'C5:4 F5:4 A5:6 R:2',
  'G5:2 F5:2 E5:2 F5:2 G5:4 C5:4',
  'D5:2 E5:2 F5:2 D5:2 B4:4 G4:4',
  'A4:2 C5:2 F5:2 A5:2 G5:2 F5:2 E5:2 D5:2',
  'C5:4 E5:2 G5:2 C6:6 R:2',
];
const A2_END = 'C6:4 G5:2 E5:2 C5:6 R:2';
const B = [
  'E5:2 A5:2 C6:2 A5:2 E5:2 A5:2 C6:4',
  'B5:2 G#5:2 E5:2 G#5:2 B5:4 E5:4',
  'A5:2 G#5:2 A5:2 B5:2 C6:4 A5:4',
  'G#5:2 F#5:2 E5:2 D5:2 B4:4 E5:4',
  'F5:2 A5:2 C6:2 A5:2 F5:4 A5:4',
  'E5:2 G5:2 C6:2 G5:2 E5:4 G5:4',
  'F#5:2 A5:2 D6:2 C6:2 A5:2 F#5:2 D5:4',
  'G5:2 A5:2 B5:2 G5:2 D5:2 B4:2 G4:4',
];
const CHORDS_A = ['C', 'G', 'Am', 'F', 'C', 'G', 'F|G', 'C'];
const CHORDS_B = ['Am', 'E', 'Am', 'E', 'F', 'C', 'D7', 'G'];

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midi(n: string): number {
  const m = n.match(/^([A-G])([#b]?)(\d)$/)!;
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function chord(name: string): { root: number; tones: number[] } {
  const m = name.match(/^([A-G][#b]?)(m|7)?$/)!;
  const root = PC[m[1][0]] + (m[1][1] === '#' ? 1 : 0);
  const tones = m[2] === 'm' ? [0, 3, 7] : m[2] === '7' ? [0, 4, 7, 10] : [0, 4, 7];
  return { root, tones };
}

interface Note { t: number; dur: number; f: number; vol: number; inst: 'lead' | 'harp' | 'bass' | 'bell' | 'kick' | 'snare' | 'hat' }

function compose(): { notes: Note[]; length: number } {
  const notes: Note[] = [];
  const sections: { mel: string[]; chords: string[]; bell: boolean }[] = [
    { mel: A, chords: CHORDS_A, bell: false },
    { mel: [...A.slice(0, 7), A2_END], chords: CHORDS_A, bell: true },
    { mel: B, chords: CHORDS_B, bell: false },
    { mel: [...A.slice(0, 7), A2_END], chords: CHORDS_A, bell: true },
  ];
  let bar = 0;
  for (const s of sections) {
    for (let i = 0; i < 8; i++, bar++) {
      const t0 = bar * BAR;
      // Melody
      let pos = 0;
      for (const tok of s.mel[i].split(' ')) {
        const [n, d] = tok.split(':');
        const dur = Number(d) * SIXTEENTH;
        if (n !== 'R') {
          const f = hz(midi(n));
          notes.push({ t: t0 + pos, dur: dur * 0.82, f, vol: 0.2, inst: 'lead' });
          if (s.bell) notes.push({ t: t0 + pos, dur: 0.35, f: f * 2, vol: 0.05, inst: 'bell' });
        }
        pos += dur;
      }
      // Harmony: Alberti bass in eighths (root, fifth, third, fifth) and oom-pah bass in quarters.
      const halves = s.chords[i].split('|');
      for (let h = 0; h < 2; h++) {
        const c = chord(halves[halves.length === 2 ? h : 0]);
        let r4 = 60 + c.root;
        if (r4 > 65) r4 -= 12;
        const third = r4 + c.tones[1], fifth = r4 + c.tones[2];
        const alberti = [r4, fifth, third, fifth];
        for (let k = 0; k < 4; k++) notes.push({ t: t0 + h * 8 * SIXTEENTH + k * 2 * SIXTEENTH, dur: 0.22, f: hz(alberti[k]), vol: 0.07, inst: 'harp' });
        const r2 = 36 + c.root;
        const bassSeq = [r2, r2 + 7];
        for (let k = 0; k < 2; k++) notes.push({ t: t0 + h * 8 * SIXTEENTH + k * 4 * SIXTEENTH, dur: 3 * SIXTEENTH, f: hz(bassSeq[k]), vol: 0.24, inst: 'bass' });
      }
      // Drums
      for (let beat = 0; beat < 4; beat++) {
        const tb = t0 + beat * 4 * SIXTEENTH;
        notes.push({ t: tb, dur: 0.15, f: 0, vol: beat % 2 === 0 ? 0.32 : 0, inst: 'kick' });
        if (beat % 2 === 1) notes.push({ t: tb, dur: 0.14, f: 0, vol: 0.09, inst: 'snare' });
        notes.push({ t: tb + 2 * SIXTEENTH, dur: 0.04, f: 0, vol: 0.035, inst: 'hat' });
      }
    }
  }
  return { notes: notes.filter((n) => n.vol > 0), length: bar * BAR };
}

/** Renders the loop as mono samples at MUSIC_RATE. */
export function renderGameMusic(): Float32Array {
  const { notes, length } = compose();
  const N = Math.round(length * MUSIC_RATE);
  const out = new Float32Array(N);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
  const TAU = Math.PI * 2;
  for (const n of notes) {
    const start = Math.round(n.t * MUSIC_RATE);
    const len = Math.round((n.dur + 0.06) * MUSIC_RATE);
    let phase = 0, hp = 0, lastNoise = 0;
    for (let i = 0; i < len; i++) {
      const t = i / MUSIC_RATE;
      let s = 0;
      switch (n.inst) {
        case 'lead': {
          // Band-limited square (odd harmonics), gentle vibrato after the attack.
          const vib = t > 0.12 ? 1 + 0.004 * Math.sin(TAU * 5.5 * t) : 1;
          phase += (TAU * n.f * vib) / MUSIC_RATE;
          for (let h = 1; h <= 9; h += 2) if (n.f * h < MUSIC_RATE / 2.2) s += Math.sin(phase * h) / h;
          const env = Math.min(1, t / 0.006) * (t < n.dur ? 0.75 + 0.25 * Math.exp(-t * 10) : Math.max(0, 1 - (t - n.dur) / 0.04));
          s *= env;
          break;
        }
        case 'harp': {
          phase += (TAU * n.f) / MUSIC_RATE;
          for (let h = 1; h <= 6; h++) s += Math.sin(phase * h) / (h * h * 0.6 + 0.4);
          s *= Math.min(1, t / 0.003) * Math.exp(-t * 9);
          break;
        }
        case 'bass': {
          phase += (TAU * n.f) / MUSIC_RATE;
          for (let h = 1; h <= 7; h += 2) s += ((h % 4 === 1 ? 1 : -1) * Math.sin(phase * h)) / (h * h);
          s *= Math.min(1, t / 0.005) * (t < n.dur ? 1 : Math.max(0, 1 - (t - n.dur) / 0.03));
          break;
        }
        case 'bell': {
          phase += (TAU * n.f) / MUSIC_RATE;
          s = (Math.sin(phase) + 0.3 * Math.sin(phase * 2.76)) * Math.exp(-t * 7);
          break;
        }
        case 'kick': {
          const f = 45 + 110 * Math.exp(-t * 30);
          phase += (TAU * f) / MUSIC_RATE;
          s = Math.sin(phase) * Math.exp(-t * 18);
          break;
        }
        case 'snare': {
          const nz = rnd();
          hp = nz - lastNoise; lastNoise = nz;
          phase += (TAU * 190) / MUSIC_RATE;
          s = (hp * 0.7 + Math.sin(phase) * 0.4) * Math.exp(-t * 22);
          break;
        }
        case 'hat': {
          const nz = rnd();
          hp = nz - lastNoise; lastNoise = nz;
          s = hp * Math.exp(-t * 90);
          break;
        }
      }
      out[(start + i) % N] += s * n.vol;
    }
  }
  // Small room echo, then normalise.
  const d1 = Math.round(0.19 * MUSIC_RATE), d2 = Math.round(0.31 * MUSIC_RATE);
  const wet = new Float32Array(N);
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < N; i++) {
    wet[i] = out[i] + 0.18 * (wet[(i - d1 + N) % N]) + 0.1 * (wet[(i - d2 + N) % N]);
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(wet[i]));
  const g = 0.85 / (peak || 1);
  for (let i = 0; i < N; i++) wet[i] *= g;
  return wet;
}
