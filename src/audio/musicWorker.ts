import { renderGameMusic } from './gameMusic';

// Synthesises the game music off the main thread (about 0.8 s of work) and hands back the samples.
const samples = renderGameMusic();
(self as unknown as Worker).postMessage(samples, [samples.buffer]);
