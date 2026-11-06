import type { DuelMode } from './DuelDirector';

// Progress and settings, saved in localStorage under a versioned key. Every access is wrapped:
// if storage is unavailable (private mode, blocked) the game keeps working in memory.

export const SAVE_KEY = 'chessMasters.save.v1';
export const SAVE_VERSION = 1;

export interface Settings {
  duelMode: DuelMode;
  sfxVolume: number; // 0..1
  musicVolume: number;
  moveHints: boolean;
  coordinates: boolean;
  guidance: boolean;
  /** Next game's clock in minutes (0 = no clock). */
  clockMinutes: 0 | 5 | 10;
  /** Next game's challenge (null = free play). */
  challengeId: string | null;
  opponent: 'computer' | 'local';
  level: 'beginner' | 'easy' | 'medium' | 'hard';
  /** The coach reads its advice aloud (device text-to-speech). */
  coachVoice: boolean;
  /** Device voice name ('' = the best British voice available). */
  voiceName: string;
  voiceRate: number; // 0.8 slow .. 1.15 fast
  voiceVolume: number; // 0..1
  /** Play the intro video (if one is installed) after "Click to start". */
  introVideo: boolean;
}

export interface SaveData {
  version: number;
  points: number;
  stars: Record<string, number>; // challenge id -> best stars (1-3)
  gamesPlayed: number;
  wins: number;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = { duelMode: 'full', sfxVolume: 0.8, musicVolume: 0.3, moveHints: true, coordinates: true, guidance: false,
  clockMinutes: 0, challengeId: null, opponent: 'computer', level: 'easy', coachVoice: true, voiceName: '', voiceRate: 1, voiceVolume: 1, introVideo: true };

export function defaultSave(): SaveData {
  return { version: SAVE_VERSION, points: 0, stars: {}, gamesPlayed: 0, wins: 0, settings: { ...DEFAULT_SETTINGS } };
}

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

function browserStorage(): StorageLike | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** Validates and fills in anything missing, so old or damaged saves still load. */
export function normalise(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData>;
  if (typeof r.points === 'number' && r.points >= 0) d.points = Math.floor(r.points);
  if (typeof r.gamesPlayed === 'number') d.gamesPlayed = r.gamesPlayed;
  if (typeof r.wins === 'number') d.wins = r.wins;
  if (r.stars && typeof r.stars === 'object') {
    for (const [k, v] of Object.entries(r.stars)) if (typeof v === 'number') d.stars[k] = Math.max(0, Math.min(3, Math.floor(v)));
  }
  if (r.settings && typeof r.settings === 'object') {
    const s = r.settings as Partial<Settings>;
    if (s.duelMode === 'full' || s.duelMode === 'short' || s.duelMode === 'off') d.settings.duelMode = s.duelMode;
    if (typeof s.sfxVolume === 'number') d.settings.sfxVolume = Math.max(0, Math.min(1, s.sfxVolume));
    if (typeof s.musicVolume === 'number') d.settings.musicVolume = Math.max(0, Math.min(1, s.musicVolume));
    if (typeof s.moveHints === 'boolean') d.settings.moveHints = s.moveHints;
    if (typeof s.coordinates === 'boolean') d.settings.coordinates = s.coordinates;
    if (typeof s.guidance === 'boolean') d.settings.guidance = s.guidance;
    if (s.clockMinutes === 0 || s.clockMinutes === 5 || s.clockMinutes === 10) d.settings.clockMinutes = s.clockMinutes;
    if (typeof s.challengeId === 'string' || s.challengeId === null) d.settings.challengeId = s.challengeId ?? null;
    if (s.opponent === 'computer' || s.opponent === 'local') d.settings.opponent = s.opponent;
    if (['beginner', 'easy', 'medium', 'hard'].includes(s.level as string)) d.settings.level = s.level!;
    if (typeof s.coachVoice === 'boolean') d.settings.coachVoice = s.coachVoice;
    if (typeof s.voiceName === 'string') d.settings.voiceName = s.voiceName;
    if (typeof s.voiceRate === 'number') d.settings.voiceRate = Math.max(0.6, Math.min(1.5, s.voiceRate));
    if (typeof s.introVideo === 'boolean') d.settings.introVideo = s.introVideo;
    if (typeof s.voiceVolume === 'number') d.settings.voiceVolume = Math.max(0, Math.min(1, s.voiceVolume));
  }
  return d;
}

export class SaveStore {
  data: SaveData;
  readonly persistent: boolean;

  constructor(private readonly storage: StorageLike | null = browserStorage()) {
    this.data = this.load();
    this.persistent = this.canWrite();
  }

  private canWrite(): boolean {
    if (!this.storage) return false;
    try { this.storage.setItem(SAVE_KEY + '.probe', '1'); return true; } catch { return false; }
  }

  load(): SaveData {
    try {
      const raw = this.storage?.getItem(SAVE_KEY);
      return raw ? normalise(JSON.parse(raw)) : defaultSave();
    } catch {
      return defaultSave();
    }
  }

  save(): boolean {
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data));
      return !!this.storage;
    } catch {
      return false;
    }
  }

  /** Records a challenge result; only a better star count replaces the old one. Returns points added. */
  awardChallenge(id: string, stars: number, points: number): number {
    const prev = this.data.stars[id] ?? 0;
    if (stars > prev) this.data.stars[id] = stars;
    this.data.points += points;
    this.save();
    return points;
  }

  addPoints(points: number): void {
    this.data.points += points;
    this.save();
  }

  recordGame(won: boolean): void {
    this.data.gamesPlayed++;
    if (won) this.data.wins++;
    this.save();
  }

  updateSettings(patch: Partial<Settings>): void {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
  }
}
