import { sound } from './sound';

// The coach's speaking voice: the browser's own text-to-speech (Web Speech API), so it costs
// nothing, needs no licences and works offline. Voices come from the device (on Windows:
// George, Hazel, Susan; Edge adds natural voices such as Ryan and Sonia; phones use Google or
// Siri voices). Chess notation is turned into words first ("Nc6" -> "Knight to C 6").

const PIECE: Record<string, string> = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight' };
const sq = (s: string) => `${s[0].toUpperCase()} ${s[1]}`;
const check = (c?: string) => (c === '#' ? ', checkmate' : c === '+' ? ', check' : '');

/** Coach text as it should be spoken: arrows, move notation and squares in plain words. */
export function speakable(text: string): string {
  return text
    .replace(/→/g, ' to ')
    .replace(/…/g, '.')
    .replace(/\bO-O-O([+#])?/g, (_, c) => `castles queen side${check(c)}`)
    .replace(/\bO-O([+#])?/g, (_, c) => `castles${check(c)}`)
    // Piece moves: Nc6, Bxd5+, Rae1, Qh4#
    .replace(/\b([KQRBN])([a-h]?[1-8]?)(x?)([a-h][1-8])([+#])?(?![a-z0-9])/g, (_, p, _from, x, to, c) => `${PIECE[p]} ${x ? 'takes' : 'to'} ${sq(to)}${check(c)}`)
    // Pawn captures and promotions: exd5, e8=Q, fxg1=N+
    .replace(/\b([a-h])x([a-h][1-8])(?:=([QRBN]))?([+#])?(?![a-z0-9])/g, (_, _f, to, pr, c) => `pawn takes ${sq(to)}${pr ? `, promotes to ${PIECE[pr]}` : ''}${check(c)}`)
    .replace(/\b([a-h][1-8])=([QRBN])([+#])?/g, (_, to, pr, c) => `${sq(to)}, promotes to ${PIECE[pr]}${check(c)}`)
    // Remaining squares and pawn moves: e4, d5+
    .replace(/\b([a-h][1-8])([+#])?(?![a-z0-9])/g, (_, s, c) => `${sq(s)}${check(c)}`)
    .replace(/\s+/g, ' ')
    .trim();
}

export interface VoiceOption { name: string; label: string }

export interface VoiceSettings { enabled: boolean; voiceName: string; rate: number; volume: number }

class CoachVoice {
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  private settings: VoiceSettings = { enabled: true, voiceName: '', rate: 1, volume: 1 };
  private speaking = 0;
  private unlocked = false;

  constructor() {
    if (!this.supported) return;
    // Phones (iOS especially) only allow speech after a tap; a silent first word unlocks it.
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    speechSynthesis.getVoices(); // starts loading the list (it arrives asynchronously)
  }

  configure(s: Partial<VoiceSettings>): void {
    this.settings = { ...this.settings, ...s };
    if (!this.settings.enabled) this.stop();
  }

  get enabled(): boolean { return this.supported && this.settings.enabled && !sound.disabled; }

  /** English voices, British first, then the most natural-sounding. */
  list(): VoiceOption[] {
    if (!this.supported) return [];
    const score = (v: SpeechSynthesisVoice) => (v.lang === 'en-GB' ? 0 : 10) + (/natural|online|neural|premium|enhanced/i.test(v.name) ? 0 : 3);
    return speechSynthesis.getVoices()
      .filter((v) => v.lang.toLowerCase().startsWith('en'))
      .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))
      .map((v) => ({ name: v.name, label: `${v.name.replace(/^(Microsoft|Google|Apple)\s+/, '').replace(/\s*[-(].*$/, '')} (${v.lang.slice(3) || v.lang})` }));
  }

  /** Calls `fn` whenever the device's voice list changes (it loads after start-up). */
  onVoicesChanged(fn: () => void): () => void {
    if (!this.supported) return () => {};
    speechSynthesis.addEventListener('voiceschanged', fn);
    return () => speechSynthesis.removeEventListener('voiceschanged', fn);
  }

  private pickVoice(): SpeechSynthesisVoice | null {
    const all = speechSynthesis.getVoices();
    const chosen = this.settings.voiceName && all.find((v) => v.name === this.settings.voiceName);
    if (chosen) return chosen;
    const best = this.list()[0];
    return best ? all.find((v) => v.name === best.name) ?? null : null;
  }

  /** Speaks the coach's lines, replacing anything still being said. */
  say(lines: string[]): void {
    if (this.enabled) this.speak(lines);
  }

  /** Speaks even when the coach voice is off (the Settings "Test" button). */
  preview(text: string): void {
    if (this.supported && !sound.disabled) this.speak([text]);
  }

  private speak(lines: string[]): void {
    this.stop();
    const voice = this.pickVoice();
    const parts = lines.map(speakable).filter(Boolean);
    if (!parts.length) return;
    sound.duckMusic(true);
    const run = ++this.speaking;
    parts.forEach((text, i) => {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB';
      u.rate = this.settings.rate;
      u.volume = this.settings.volume;
      u.pitch = 1.05;
      if (i === parts.length - 1) u.onend = u.onerror = () => { if (run === this.speaking) sound.duckMusic(false); };
      speechSynthesis.speak(u); // one utterance per line: short ones never get cut off
    });
  }

  stop(): void {
    if (!this.supported) return;
    this.speaking++;
    speechSynthesis.cancel();
    sound.duckMusic(false);
  }
}

export const voice = new CoachVoice();
