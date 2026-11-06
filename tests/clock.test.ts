import { describe, expect, it } from 'vitest';
import { ChessClock, formatClock } from '../src/game/clock';

describe('chess clock', () => {
  it('only runs for the side to move', () => {
    const c = new ChessClock(60_000);
    c.start('w');
    c.tick(1000);
    c.switchTo('b');
    c.tick(2500);
    expect(c.remainingMs('w')).toBe(59_000);
    expect(c.remainingMs('b')).toBe(57_500);
  });

  it('is paused during duels: no time is deducted from either player', () => {
    const c = new ChessClock(60_000);
    c.start('w');
    c.tick(500);
    c.pause('duel');
    for (let i = 0; i < 300; i++) c.tick(16); // ~4.8 s of duel
    expect(c.remainingMs('w')).toBe(59_500);
    expect(c.remainingMs('b')).toBe(60_000);
    expect(c.usedMs('w')).toBe(500);
    c.resume('duel');
    c.switchTo('b');
    c.tick(1000);
    expect(c.remainingMs('b')).toBe(59_000);
  });

  it('stays paused until every pause reason is cleared', () => {
    const c = new ChessClock(10_000);
    c.start('w');
    c.pause('duel');
    c.pause('promotion');
    c.resume('duel');
    c.tick(1000);
    expect(c.remainingMs('w')).toBe(10_000);
    c.resume('promotion');
    c.tick(1000);
    expect(c.remainingMs('w')).toBe(9_000);
  });

  it('flags a side that runs out of time', () => {
    const c = new ChessClock(1000);
    c.start('b');
    expect(c.tick(600)).toBeNull();
    expect(c.tick(600)).toBe('b');
    expect(c.remainingMs('b')).toBe(0);
    expect(c.running).toBe(false);
  });

  it('counts time used even when untimed', () => {
    const c = new ChessClock(null);
    c.start('w');
    c.tick(1234);
    expect(c.usedMs('w')).toBe(1234);
    expect(c.remainingMs('w')).toBe(Infinity);
  });

  it('formats times', () => {
    expect(formatClock(600_000)).toBe('10:00');
    expect(formatClock(61_001)).toBe('1:02');
    expect(formatClock(Infinity)).toBe('--:--');
  });
});
