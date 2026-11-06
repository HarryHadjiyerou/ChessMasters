import type { Analysis, EngineResult, Level } from './engine';

/** Main-thread client for the engine worker. Adds a short "thinking" pause so replies feel natural. */
export class ComputerOpponent {
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: never) => void; reject: (e: Error) => void }>();

  constructor(public level: Level) {
    this.worker.onmessage = (e: MessageEvent<{ id: number; result?: never; error?: string }>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.result) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error ?? 'engine error'));
    };
  }

  async move(fen: string, opts: { instant?: boolean } = {}): Promise<EngineResult> {
    const started = performance.now();
    const id = this.nextId++;
    const result = await new Promise<EngineResult>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: never) => void, reject });
      this.worker.postMessage({ id, fen, level: this.level });
    });
    const minThink = opts.instant ? 0 : 550 + Math.random() * 450;
    const elapsed = performance.now() - started;
    if (elapsed < minThink) await new Promise((r) => setTimeout(r, minThink - elapsed));
    return result;
  }

  /** Coach analysis: best move, exactly-scored alternatives (incl. `extra` book moves) and the expected line. */
  analyse(fen: string, extra: { from: string; to: string }[] = [], timeMs = 2500): Promise<Analysis> {
    const id = this.nextId++;
    return new Promise<Analysis>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: never) => void, reject });
      this.worker.postMessage({ id, fen, kind: 'analyse', extra, timeMs });
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
