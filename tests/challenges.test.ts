import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { ChallengeTracker, type ChallengeDef } from '../src/game/challenges';
import type { GameEvent } from '../src/game/events';
import type { Colour, MoveResult, PieceType } from '../src/game/rules';

const defs: ChallengeDef[] = JSON.parse(fs.readFileSync('public/data/challenges.json', 'utf8')).challenges;
const def = (id: string) => defs.find((d) => d.id === id)!;

const mv = (colour: Colour, captured?: PieceType, promotion?: 'q'): MoveResult => ({
  from: 'a1', to: 'a2', san: 'x', colour, piece: 'p', enPassant: false, check: false, fen: '', captured, promotion,
});
const move = (colour: Colour, n = 1): GameEvent[] => Array.from({ length: n }, () => ({ type: 'move', move: mv(colour), moveNumber: 0 }));
const capture = (colour: Colour, t: PieceType): GameEvent[] => [{ type: 'move', move: mv(colour, t), moveNumber: 0 }, { type: 'capture', move: mv(colour, t) }];
const clock = (w: number, b = 0): GameEvent => ({ type: 'clock', usedMs: { w, b }, remainingMs: { w: 0, b: 0 } });
const end = (winner: Colour | null): GameEvent => ({ type: 'end', result: winner ? { over: true, reason: 'checkmate', winner } : { over: true, reason: 'stalemate', winner: null } });

function run(id: string, events: GameEvent[], player: Colour = 'w') {
  const t = new ChallengeTracker(def(id), player);
  for (const e of events) t.handle(e);
  return t;
}

describe('challenge engine', () => {
  it('loads all five PoC challenges', () => {
    expect(defs.map((d) => d.id)).toEqual(['speed-win', 'beat-the-clock', 'bishop-hunter', 'pawn-power', 'untouchable-queen']);
  });

  describe('Speed Win', () => {
    it('awards 3 stars for a 15-move win', () => {
      expect(run('speed-win', [...move('w', 15), end('w')]).outcome).toMatchObject({ status: 'complete', stars: 3, points: 150 });
    });
    it('awards 1 star for a 25-move win', () => {
      expect(run('speed-win', [...move('w', 25), end('w')]).outcome?.stars).toBe(1);
    });
    it('fails on move 26, even if the game is later won', () => {
      const t = run('speed-win', move('w', 26));
      expect(t.status).toBe('failed');
      t.handle(end('w'));
      expect(t.outcome).toMatchObject({ status: 'failed', stars: 0, points: 0 });
    });
    it('only counts the player’s own moves', () => {
      expect(run('speed-win', [...move('b', 40), ...move('w', 10)]).status).toBe('active');
    });
    it('fails if the game is lost or drawn', () => {
      expect(run('speed-win', [...move('w', 5), end('b')]).outcome?.status).toBe('failed');
      expect(run('speed-win', [...move('w', 5), end(null)]).outcome?.status).toBe('failed');
    });
  });

  describe('Beat the Clock', () => {
    it('completes under 10 minutes and grades by time', () => {
      expect(run('beat-the-clock', [clock(200_000), end('w')]).outcome?.stars).toBe(3);
      expect(run('beat-the-clock', [clock(500_000), end('w')]).outcome?.stars).toBe(1);
    });
    it('fails once the player has used 10 minutes', () => {
      const t = run('beat-the-clock', [clock(600_000)]);
      expect(t.status).toBe('failed');
    });
    it('uses only the player’s clock', () => {
      expect(run('beat-the-clock', [clock(1000, 900_000), end('w')]).outcome?.status).toBe('complete');
    });
  });

  describe('Bishop Hunter', () => {
    it('needs both bishops', () => {
      expect(run('bishop-hunter', [...capture('w', 'b'), end('w')]).outcome).toMatchObject({ status: 'failed', reason: 'Goal not reached' });
      expect(run('bishop-hunter', [...capture('w', 'b'), ...capture('w', 'b'), end('w')]).outcome?.status).toBe('complete');
    });
    it('ignores bishops the opponent captures', () => {
      expect(run('bishop-hunter', [...capture('b', 'b'), ...capture('b', 'b'), end('w')]).outcome?.status).toBe('failed');
    });
    it('works for the Dark player', () => {
      expect(run('bishop-hunter', [...capture('b', 'b'), ...capture('b', 'b'), end('b')], 'b').outcome?.status).toBe('complete');
    });
  });

  describe('Pawn Power', () => {
    it('needs a promotion and a win', () => {
      const promo: GameEvent = { type: 'promotion', move: mv('w', undefined, 'q') };
      expect(run('pawn-power', [promo, end('w')]).outcome?.status).toBe('complete');
      expect(run('pawn-power', [promo, end('b')]).outcome?.status).toBe('failed');
      expect(run('pawn-power', [end('w')]).outcome?.status).toBe('failed');
      expect(run('pawn-power', [promo, promo, end('w')]).outcome?.stars).toBe(3);
    });
  });

  describe('Untouchable Queen', () => {
    it('fails the moment the queen is captured', () => {
      const t = run('untouchable-queen', capture('b', 'q'));
      expect(t.status).toBe('failed');
      t.handle(end('w'));
      expect(t.outcome?.status).toBe('failed');
    });
    it('completes and grades by total losses', () => {
      expect(run('untouchable-queen', [...capture('b', 'p'), end('w')]).outcome?.stars).toBe(3);
      const many = Array.from({ length: 5 }, () => capture('b', 'p')).flat();
      expect(run('untouchable-queen', [...many, end('w')]).outcome?.stars).toBe(2);
    });
    it('reports live progress', () => {
      const t = run('untouchable-queen', []);
      expect(t.progress()[0]).toMatchObject({ text: 'Yes', done: true });
      t.handle(capture('b', 'q')[1]);
      expect(t.progress()[0].text).toBe('Lost');
    });
  });
});
