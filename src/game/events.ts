import type { Colour, GameEnd, MoveResult } from './rules';

// Game events, consumed by the HUD, audio and the challenge engine.
export type GameEvent =
  | { type: 'start'; fen: string }
  | { type: 'move'; move: MoveResult; moveNumber: number }
  | { type: 'capture'; move: MoveResult }
  | { type: 'check'; colour: Colour }
  | { type: 'promotion'; move: MoveResult }
  | { type: 'undo' }
  | { type: 'thinking' }
  /** The pawns' opening cheer has started (for the crowd sound). */
  | { type: 'cheer' }
  | { type: 'focus'; square: string | null; selected: boolean }
  /** Tried a move that isn't allowed; `reason` is a short child-friendly explanation. */
  | { type: 'invalid'; square: string; reason: string }
  /** Guide mode: the move would lose material; shown before it is played. */
  | { type: 'caution'; square: string; reason: string }
  /** The exact moment a capturing piece hits (or poofs) its target. */
  | { type: 'impact'; move: MoveResult; at: { x: number; y: number; z: number } }
  | { type: 'clock'; usedMs: Record<Colour, number>; remainingMs: Record<Colour, number> }
  | { type: 'end'; result: Extract<GameEnd, { over: true }> | { over: true; reason: 'timeout' | 'resign' | 'draw-agreed'; winner: Colour | null } }
  | { type: 'duel'; phase: 'start' | 'end'; durationMs?: number; animSeconds?: number };

export type Listener = (e: GameEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();
  on(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e: GameEvent): void { for (const fn of this.listeners) fn(e); }
}
