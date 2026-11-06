import { sound } from '../audio/sound';
import type { ChallengeDef } from '../game/challenges';
import type { Settings } from '../game/save';
import { ICONS, type IconName } from './icons';
import { voice } from '../audio/voice';

// The Settings card behind the cog (menu screens and in game). Game options (clock, challenge)
// apply to the next game; help, duels and sound apply straight away.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface SettingsPanelOptions {
  settings: Settings;
  challenges: ChallengeDef[];
  getStars: (id: string) => number;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  /** In a game: clock and challenge are shown as "next game" options. */
  inGame?: boolean;
  /** Menus with an intro video installed: shows the Intro video row with a Watch button. */
  watchIntro?: () => void;
  /** In a game: this game's move list and PGN download. */
  record?: { moves: () => void; pgn: () => void };
  /** Extra buttons at the bottom (Resign, Menu...). */
  actions?: [string, () => void, boolean?][];
}

export function buildSettingsPanel(o: SettingsPanelOptions): HTMLElement {
  let s = { ...o.settings };
  const change = (patch: Partial<Settings>) => { s = { ...s, ...patch }; o.onChange(patch); };
  const box = el('div', 'royal-card settings-card settings-panel');
  box.dataset.id = 'settings';
  const ribbon = el('div', 'card-ribbon');
  ribbon.append(el('span', undefined, 'Settings'));
  box.append(ribbon);
  const body = el('div', 'settings-body');
  box.append(body);

  const section = (title: string, note?: string) => {
    const h = el('div', 'set-section');
    h.append(el('span', undefined, title));
    if (note) h.append(el('span', 'set-note', note));
    body.append(h);
  };
  const row = (label: string, control: HTMLElement, id?: string) => {
    const r = el('div', 'set-row');
    if (id) r.dataset.id = id;
    r.append(el('span', 'set-label', label), control);
    body.append(r);
  };
  const seg = <T>(options: [T, string][], value: T, onPick: (v: T) => void) => {
    const g = el('div', 'seg');
    for (const [v, l] of options) {
      const b = el('button', 'seg-btn', l);
      b.dataset.value = String(v);
      b.setAttribute('aria-pressed', String(v === value));
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        sound.play('click');
        for (const x of g.children) x.setAttribute('aria-pressed', String(x === b));
        onPick(v);
      });
      g.append(b);
    }
    return g;
  };
  const toggle = (value: boolean, onPick: (v: boolean) => void) => {
    const b = el('button', 'switch-btn');
    b.setAttribute('aria-pressed', String(value));
    b.append(el('span', 'switch'));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sound.play('click');
      const v = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(v));
      onPick(v);
    });
    return b;
  };
  const slider = (value: number, onPick: (v: number) => void) => {
    const i = el('input', 'royal-range');
    i.type = 'range'; i.min = '0'; i.max = '100'; i.value = String(Math.round(value * 100));
    i.addEventListener('input', () => onPick(Number(i.value) / 100));
    i.addEventListener('change', () => sound.play('click'));
    return i;
  };

  // --- Game (next game) ---
  section('Game', o.inGame ? 'applies to your next game' : undefined);
  row('Clock', seg<0 | 5 | 10>([[0, 'No clock'], [10, '10 min'], [5, '5 min']], s.clockMinutes, (v) => change({ clockMinutes: v })), 'clock');
  const chall = el('div', 'set-challenges');
  chall.dataset.id = 'challenge';
  const desc = el('div', 'set-challenge-desc');
  const describe = (c: ChallengeDef | null) => {
    desc.textContent = c ? `${c.description} ${c.pointsPerStar} points per star. Undo is off.` : 'Free play: no challenge, Undo is on.';
  };
  const medal = (c: ChallengeDef | null) => {
    const wrap = el('div', 'medal-wrap');
    const b = el('button', 'medal medal-small');
    b.dataset.value = c?.id ?? 'none';
    b.setAttribute('aria-pressed', String((c?.id ?? null) === s.challengeId));
    b.setAttribute('aria-label', c?.name ?? 'Free play');
    b.insertAdjacentHTML('afterbegin', ICONS[(c?.icon ?? 'crown') as IconName] ?? ICONS.objectives);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sound.play('click');
      for (const x of chall.querySelectorAll('.medal')) x.setAttribute('aria-pressed', String(x === b));
      describe(c);
      change({ challengeId: c?.id ?? null });
    });
    const stars = c ? o.getStars(c.id) : 0;
    wrap.append(b, el('div', 'medal-label', c?.name ?? 'Free Play'), el('div', 'medal-stars', c ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : ''));
    return wrap;
  };
  chall.append(medal(null), ...o.challenges.map((c) => medal(c)));
  describe(o.challenges.find((c) => c.id === s.challengeId) ?? null);
  const challBlock = el('div', 'set-block');
  challBlock.append(el('div', 'set-label', 'Challenge'), chall, desc);
  body.append(challBlock);

  // --- Help ---
  section('Help');
  row('Coach guide', toggle(s.guidance, (v) => change({ guidance: v })), 'guidance');
  row('Move hints', toggle(s.moveHints, (v) => change({ moveHints: v })), 'move-hints');
  row('Coordinates', toggle(s.coordinates, (v) => change({ coordinates: v })), 'coordinates');

  // --- Coach voice (device text-to-speech) ---
  section('Coach voice');
  if (!voice.supported) {
    row('Speak advice', el('span', 'set-note', 'Not available on this device'), 'coach-voice');
  } else {
    row('Speak advice', toggle(s.coachVoice, (v) => change({ coachVoice: v })), 'coach-voice');
    const pick = el('select', 'royal-select');
    pick.setAttribute('aria-label', 'Coach voice');
    const fill = () => {
      const opts = voice.list();
      pick.replaceChildren(el('option', undefined, 'Automatic (best British)'));
      (pick.firstElementChild as HTMLOptionElement).value = '';
      for (const v of opts) {
        const o = el('option', undefined, v.label);
        o.value = v.name;
        pick.append(o);
      }
      pick.value = opts.some((v) => v.name === s.voiceName) ? s.voiceName : '';
    };
    fill();
    const off = voice.onVoicesChanged(fill);
    new MutationObserver((_, obs) => { if (!box.isConnected) { off(); obs.disconnect(); } }).observe(document.body, { childList: true, subtree: true });
    pick.addEventListener('change', (e) => {
      e.stopPropagation();
      change({ voiceName: pick.value });
      voice.configure({ voiceName: pick.value });
      voice.preview("Hello! I'm your chess coach.");
    });
    for (const ev of ['click', 'pointerdown']) pick.addEventListener(ev, (e) => e.stopPropagation());
    const test = el('button', 'plate-btn quiet set-test', 'Test');
    test.dataset.id = 'voice-test';
    test.addEventListener('click', (e) => { e.stopPropagation(); voice.preview('Best move: Knight g1 to f3. It brings your Knight towards the centre.'); });
    const wrapPick = el('div', 'set-voice');
    wrapPick.append(pick, test);
    row('Voice', wrapPick, 'voice-name');
    row('Speed', seg<number>([[0.85, 'Slow'], [1, 'Normal'], [1.15, 'Fast']], [0.85, 1, 1.15].reduce((a, b) => (Math.abs(b - s.voiceRate) < Math.abs(a - s.voiceRate) ? b : a)), (v) => { change({ voiceRate: v }); voice.configure({ rate: v }); }), 'voice-rate');
  }

  // --- This game's record (in game only) ---
  if (o.record) {
    const r = o.record;
    section('This game');
    const btns = el('div', 'set-record');
    for (const [label, id, fn] of [['Move list', 'moves', r.moves], ['Save PGN', 'pgn', r.pgn]] as [string, string, () => void][]) {
      const b = el('button', 'plate-btn quiet set-record-btn');
      b.dataset.id = id;
      b.insertAdjacentHTML('afterbegin', ICONS[id as IconName]);
      b.append(el('span', undefined, label));
      b.addEventListener('click', (e) => { e.stopPropagation(); sound.play('click'); fn(); });
      btns.append(b);
    }
    row('Record', btns, 'record');
  }

  // --- Duels and sound ---
  section('Duels & Sound');
  row('Capture duels', seg<Settings['duelMode']>([['full', 'Full'], ['short', 'Short'], ['off', 'Off']], s.duelMode, (v) => change({ duelMode: v })), 'duel-mode');
  row('Sound', slider(s.sfxVolume, (v) => change({ sfxVolume: v })));
  row('Music', slider(s.musicVolume, (v) => change({ musicVolume: v })));
  if (voice.supported) row('Voice', slider(s.voiceVolume, (v) => change({ voiceVolume: v })), 'voice-volume');
  if (o.watchIntro) {
    const watch = o.watchIntro;
    const ctl = el('div', 'set-voice');
    const btn = el('button', 'plate-btn quiet set-test', 'Watch');
    btn.dataset.id = 'intro-watch';
    btn.addEventListener('click', (e) => { e.stopPropagation(); sound.play('click'); watch(); });
    ctl.append(btn, toggle(s.introVideo, (v) => change({ introVideo: v })));
    row('Intro video', ctl, 'intro-video');
  }

  const acts = el('div', 'card-buttons');
  for (const [label, fn, quiet] of [...(o.actions ?? []), ['Close', o.onClose, true] as [string, () => void, boolean]]) {
    const b = el('button', `plate-btn${quiet ? ' quiet' : ''}`, label);
    b.dataset.id = label.toLowerCase().replace(/\s+/g, '-');
    b.addEventListener('click', (e) => { e.stopPropagation(); sound.play('click'); fn(); });
    acts.append(b);
  }
  box.append(acts);
  return box;
}
