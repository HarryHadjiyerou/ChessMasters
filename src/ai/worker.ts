import { analyse, chooseMove, type Level } from './engine';

// Runs the engine off the main thread so the UI never freezes while it thinks.
type Req = { id: number; fen: string; level: Level; kind?: 'move' } | { id: number; fen: string; kind: 'analyse'; extra?: { from: string; to: string }[]; timeMs?: number };
self.onmessage = (e: MessageEvent<Req>) => {
  const r = e.data;
  try {
    const result = r.kind === 'analyse' ? analyse(r.fen, { extra: r.extra, timeMs: r.timeMs }) : chooseMove(r.fen, r.level);
    (self as unknown as Worker).postMessage({ id: r.id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: r.id, error: String(err) });
  }
};
