import { describe, expect, it } from 'vitest';
import { Timeline } from '../src/util/timeline';

describe('timeline', () => {
  it('runs tweens over time', async () => {
    const tl = new Timeline();
    let v = 0;
    const done = tl.tween(1, (t) => { v = t; }, (t) => t);
    tl.update(0.5);
    expect(v).toBeCloseTo(0.5);
    tl.update(0.6);
    await done;
    expect(v).toBe(1);
  });

  it('skip finishes the current step and every later step instantly', async () => {
    const tl = new Timeline();
    const log: string[] = [];
    const seq = (async () => {
      await tl.tween(2, (t) => { if (t === 1) log.push('a'); });
      await tl.wait(3);
      await tl.tween(2, (t) => { if (t === 1) log.push('b'); });
      log.push('end');
    })();
    tl.update(0.1);
    tl.skip();
    await seq;
    expect(log).toEqual(['a', 'b', 'end']);
  });
});
