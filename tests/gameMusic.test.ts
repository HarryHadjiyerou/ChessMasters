import { describe, expect, it } from 'vitest';
import { MUSIC_RATE, renderGameMusic } from '../src/audio/gameMusic';

describe('game music', () => {
  it('renders a ~50 s loop that is loud enough, never clips and has no silent gaps', () => {
    const t0 = performance.now();
    const s = renderGameMusic();
    const ms = performance.now() - t0;
    const seconds = s.length / MUSIC_RATE;
    expect(seconds).toBeGreaterThan(45);
    expect(seconds).toBeLessThan(55);
    let peak = 0;
    for (const v of s) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(0.86);
    // Energy in every half-second window (the tune keeps going).
    const win = MUSIC_RATE / 2;
    for (let i = 0; i + win <= s.length; i += win) {
      let e = 0;
      for (let j = i; j < i + win; j++) e += s[j] * s[j];
      expect(Math.sqrt(e / win)).toBeGreaterThan(0.02);
    }
    // Seamless loop: the end and the start join without a jump.
    expect(Math.abs(s[s.length - 1] - s[0])).toBeLessThan(0.2);
    console.log(`game music: ${seconds.toFixed(1)} s, rendered in ${Math.round(ms)} ms`);
  });
});
