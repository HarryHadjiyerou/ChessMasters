import { describe, expect, it } from 'vitest';
import { speakable } from '../src/audio/voice';

describe('coach voice wording', () => {
  it('reads arrows and squares as words', () => {
    expect(speakable('Best move: Knight g1 → f3')).toBe('Best move: Knight G 1 to F 3');
  });
  it('reads move notation as words', () => {
    expect(speakable('Next: if Dark plays Nc6, play Pawn d2 → d4.')).toBe('Next: if Dark plays Knight to C 6, play Pawn D 2 to D 4.');
    expect(speakable('threatens checkmate with Qxf7#.')).toBe('threatens checkmate with Queen takes F 7, checkmate.');
    expect(speakable('Dark will probably reply exd5.')).toBe('Dark will probably reply pawn takes D 5.');
    expect(speakable('then Rae1+ and O-O-O')).toBe('then Rook to E 1, check and castles queen side');
    expect(speakable('e8=Q')).toBe('E 8, promotes to Queen');
  });
  it('leaves ordinary words alone', () => {
    const t = "Be careful! Bring your Bishop back. King's Pawn Opening.";
    expect(speakable(t)).toBe(t);
  });
});
