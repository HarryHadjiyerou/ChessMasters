import { describe, expect, it } from 'vitest';
import { SAVE_KEY, SaveStore, defaultSave, type StorageLike } from '../src/game/save';

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

describe('save / load', () => {
  it('round-trips progress and settings', () => {
    const mem = new MemoryStorage();
    const a = new SaveStore(mem);
    a.awardChallenge('speed-win', 2, 150);
    a.recordGame(true);
    a.updateSettings({ duelMode: 'short', musicVolume: 0.1 });
    const b = new SaveStore(mem);
    expect(b.data.points).toBe(150);
    expect(b.data.stars['speed-win']).toBe(2);
    expect(b.data.wins).toBe(1);
    expect(b.data.settings.duelMode).toBe('short');
    expect(b.data.settings.musicVolume).toBe(0.1);
    expect(JSON.parse(mem.getItem(SAVE_KEY)!).version).toBe(1);
  });

  it('keeps the best star rating', () => {
    const s = new SaveStore(new MemoryStorage());
    s.awardChallenge('x', 3, 10);
    s.awardChallenge('x', 1, 10);
    expect(s.data.stars.x).toBe(3);
    expect(s.data.points).toBe(20);
  });

  it('survives corrupt or hostile saves', () => {
    const mem = new MemoryStorage();
    mem.setItem(SAVE_KEY, '{not json');
    expect(new SaveStore(mem).data).toEqual(defaultSave());
    mem.setItem(SAVE_KEY, JSON.stringify({ points: -5, stars: { a: 99 }, settings: { duelMode: 'nonsense', sfxVolume: 7 } }));
    const d = new SaveStore(mem).data;
    expect(d.points).toBe(0);
    expect(d.stars.a).toBe(3);
    expect(d.settings.duelMode).toBe('full');
    expect(d.settings.sfxVolume).toBe(1);
  });

  it('works when storage is unavailable or throws', () => {
    const none = new SaveStore(null);
    none.addPoints(5);
    expect(none.data.points).toBe(5);
    expect(none.persistent).toBe(false);
    const throwing: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const t = new SaveStore(throwing);
    expect(t.save()).toBe(false);
    t.addPoints(3);
    expect(t.data.points).toBe(3);
  });
});
