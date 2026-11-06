import { sound } from '../audio/sound';

// Optional intro video, played full-screen after "Click to start" (the tap lets it play with
// sound), then the menus carry on. The video comes from the "INTRO VIDEO" folder next to the
// launcher, which copies it to public/assets/video/ (tools/copy-intro-video.ps1). With no
// video there, nothing changes. Shown whole (letterboxed, never cropped); skippable.

declare const __INTRO_VIDEO__: string | null; // set by vite.config.ts

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** URL of the intro video if one is installed and this browser can play it, else null. */
export function findIntroVideo(): string | null {
  const url = typeof __INTRO_VIDEO__ === 'string' ? __INTRO_VIDEO__ : null;
  if (!url) return null;
  return document.createElement('video').canPlayType(url.endsWith('.webm') ? 'video/webm' : 'video/mp4') ? url : null;
}

/** Plays the video full-screen; resolves when it ends, is skipped, or cannot play. */
export function playIntroVideo(url: string, volume: number): Promise<void> {
  return new Promise((resolve) => {
    const box = el('div', 'intro-video');
    box.dataset.id = 'intro-video';
    const video = el('video');
    video.src = url;
    video.playsInline = true; // iPhone: play in the page, not its own full-screen player
    video.preload = 'auto';
    video.volume = Math.max(0, Math.min(1, volume));
    const skip = el('button', 'plate-btn intro-skip', 'Skip ▸');
    skip.dataset.id = 'intro-skip';
    box.append(video, skip);
    document.body.append(box);
    requestAnimationFrame(() => box.classList.add('shown'));

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey, true);
      video.pause();
      box.classList.remove('shown');
      setTimeout(() => { box.remove(); video.removeAttribute('src'); video.load(); }, 400);
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); finish(); }
    };
    window.addEventListener('keydown', onKey, true);
    box.addEventListener('pointerdown', (e) => { e.stopPropagation(); sound.play('click'); finish(); }); // tap anywhere (or Skip) skips
    box.addEventListener('click', (e) => e.stopPropagation());
    video.addEventListener('ended', finish);
    video.addEventListener('error', finish);
    // Started from the player's tap, so sound is allowed; if a browser still refuses, play muted.
    video.play().catch(() => { video.muted = true; return video.play(); }).catch(finish);
  });
}
