// Named openings (real names, standard move orders) with a kid-friendly idea for each.
// Order matters: when several lines continue the current game, the earlier one is suggested,
// so friendly main lines (Italian Game) come before sharper ones.

export interface Opening {
  name: string;
  moves: string[]; // SAN without check marks
  idea: string;
  /** Sacrificial lines: still named when played, but the coach never steers a learner into them. */
  gambit?: boolean;
}

export const OPENINGS: Opening[] = [
  // 1.e4 e5
  { name: 'Fried Liver Attack', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7'], idea: 'A daring Knight sacrifice on f7 to drag the enemy King out into the open.' , gambit: true },
  { name: 'Evans Gambit', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'b4'], idea: 'Offer a pawn to win time and build a big pawn centre.' , gambit: true },
  { name: 'Giuoco Piano', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3'], idea: 'The "quiet game": prepare d4 to take over the centre.' },
  { name: 'Two Knights Defence', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'], idea: 'Dark brings out a second Knight and attacks the e4 pawn.' },
  { name: 'Italian Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], idea: 'The Bishop on c4 aims at f7, the weakest square next to the enemy King.' },
  { name: 'Ruy Lopez', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], idea: 'Also called the Spanish Game: the Bishop pressures the Knight that guards e5.' },
  { name: 'Scotch Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'], idea: 'Strike in the centre straight away with d4.' },
  { name: 'Four Knights Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6'], idea: 'Both sides bring out both Knights: simple, solid development.' },
  { name: "Petrov's Defence", moves: ['e4', 'e5', 'Nf3', 'Nf6'], idea: 'Dark copies Light and counter-attacks the e4 pawn.' },
  { name: 'Philidor Defence', moves: ['e4', 'e5', 'Nf3', 'd6'], idea: 'Dark protects e5 with a pawn and keeps a solid position.' },
  { name: "King's Gambit", moves: ['e4', 'e5', 'f4'], idea: 'An old attacking gambit: give a pawn to open lines against the King.' , gambit: true },
  { name: 'Vienna Game', moves: ['e4', 'e5', 'Nc3'], idea: 'Develop the Knight first and keep the f-pawn ready to attack.' },
  { name: 'Open Game', moves: ['e4', 'e5', 'Nf3', 'Nc6'], idea: 'Both sides fight for the centre and develop their Knights.' },
  { name: "King's Knight Opening", moves: ['e4', 'e5', 'Nf3'], idea: 'The Knight attacks e5 and gets ready for castling.' },
  { name: "King's Pawn Game", moves: ['e4', 'e5'], idea: 'Both sides put a pawn in the centre: the most classical start.' },
  // 1.e4 other
  { name: 'Sicilian Najdorf', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'], idea: 'A famous fighting line: the little pawn move a6 controls b5.' },
  { name: 'Open Sicilian', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4'], idea: 'Light opens the centre to get active pieces.' },
  { name: 'Sicilian Defence', moves: ['e4', 'c5'], idea: 'Dark fights for the centre from the side with the c-pawn: a fighting defence.' },
  { name: 'French Defence', moves: ['e4', 'e6', 'd4', 'd5'], idea: 'Dark builds a strong pawn chain and challenges e4.' },
  { name: 'French Defence', moves: ['e4', 'e6'], idea: 'Dark prepares d5 to challenge the centre.' },
  { name: 'Caro-Kann Defence', moves: ['e4', 'c6', 'd4', 'd5'], idea: 'A very solid defence: c6 supports the d5 pawn.' },
  { name: 'Caro-Kann Defence', moves: ['e4', 'c6'], idea: 'Dark prepares d5 with the support of the c6 pawn.' },
  { name: 'Scandinavian Defence', moves: ['e4', 'd5'], idea: 'Dark attacks the e4 pawn immediately.' },
  { name: 'Pirc Defence', moves: ['e4', 'd6', 'd4', 'Nf6'], idea: 'Dark lets Light take the centre and plans to attack it later.' },
  { name: "Alekhine's Defence", moves: ['e4', 'Nf6'], idea: 'Dark tempts the Light pawns forward so they can be attacked.' },
  // 1.d4
  { name: "Queen's Gambit Declined", moves: ['d4', 'd5', 'c4', 'e6'], idea: 'Dark says "no thanks" to the pawn and keeps a strong centre.' },
  { name: "Queen's Gambit Accepted", moves: ['d4', 'd5', 'c4', 'dxc4'], idea: 'Dark takes the pawn; Light will win it back and take the centre.' },
  { name: 'Slav Defence', moves: ['d4', 'd5', 'c4', 'c6'], idea: 'Dark protects d5 with the c-pawn and keeps the Bishop free.' },
  { name: "Queen's Gambit", moves: ['d4', 'd5', 'c4'], idea: 'Light offers the c-pawn to pull Dark’s d-pawn away from the centre.' },
  { name: 'London System', moves: ['d4', 'd5', 'Bf4'], idea: 'A simple set-up: Bishop to f4, then e3, Nf3 and castle.' },
  { name: 'London System', moves: ['d4', 'Nf6', 'Bf4'], idea: 'A simple set-up: Bishop to f4, then e3, Nf3 and castle.' },
  { name: 'Nimzo-Indian Defence', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'], idea: 'The Bishop pins the Knight to stop Light taking the centre with e4.' },
  { name: "King's Indian Defence", moves: ['d4', 'Nf6', 'c4', 'g6'], idea: 'Dark plans to put the Bishop on g7 (a fianchetto) and castle quickly.' },
  { name: 'Dutch Defence', moves: ['d4', 'f5'], idea: 'Dark grabs space on the King side with the f-pawn.' },
  { name: "Queen's Pawn Game", moves: ['d4', 'd5'], idea: 'Both sides put a pawn in the centre.' },
  // Flank openings
  { name: 'Réti Opening', moves: ['Nf3', 'd5', 'c4'], idea: 'Attack the centre from the side instead of occupying it.' },
  { name: 'English Opening', moves: ['c4'], idea: 'Light controls d5 from the side with the c-pawn.' },
  // First moves (most general names, last so deeper lines are preferred for suggestions)
  { name: "King's Pawn Opening", moves: ['e4'], idea: 'Put a pawn in the centre and open lines for your Queen and Bishop.' },
  { name: "Queen's Pawn Opening", moves: ['d4'], idea: 'Put a pawn in the centre, protected by your Queen.' },
];

/** The name to explain a book move with: the line it completes, else the deepest line so far. */
export function openingForMove(history: string[], san: string): Opening | null {
  const next = [...history, san];
  return openingJustReached(next) ?? currentOpening(next);
}

const clean = (san: string) => san.replace(/[+#]/g, '');

/** The deepest named opening that the game history exactly follows so far (or null). */
export function currentOpening(history: string[]): Opening | null {
  const h = history.map(clean);
  let best: Opening | null = null;
  for (const o of OPENINGS) {
    if (o.moves.length > h.length) continue;
    if (o.moves.every((m, i) => m === h[i]) && (!best || o.moves.length > best.moves.length)) best = o;
  }
  return best;
}

/** An opening whose line is exactly the history (just reached), or null. */
export function openingJustReached(history: string[]): Opening | null {
  const h = history.map(clean);
  return OPENINGS.find((o) => o.moves.length === h.length && o.moves.every((m, i) => m === h[i])) ?? null;
}

/** Next book move continuing a named line (first match in list order wins), or null. */
export function bookMove(history: string[]): { san: string; opening: Opening } | null {
  const h = history.map(clean);
  for (const o of OPENINGS) {
    if (o.gambit || o.moves.length <= h.length) continue;
    if (h.every((m, i) => m === o.moves[i])) return { san: o.moves[h.length], opening: o };
  }
  return null;
}
