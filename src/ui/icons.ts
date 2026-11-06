// Inline SVG icons for the HUD medallions, drawn for this game (gold fill, dark outline).
// Every icon uses a 24x24 viewBox; `currentColor` is not used so the gold gradient shows.

const DEFS = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset=".45" stop-color="#f2c45e"/><stop offset="1" stop-color="#a8701f"/></linearGradient></defs>`;
const wrap = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${DEFS}<g fill="url(#g)" stroke="#3a2208" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;

export const ICONS = {
  info: wrap('<path d="M3 5.5c2.6-1 5.7-1 8.4.6v13.4c-2.7-1.6-5.8-1.6-8.4-.6z"/><path d="M21 5.5c-2.6-1-5.7-1-8.4.6v13.4c2.7-1.6 5.8-1.6 8.4-.6z"/>'),
  objectives: wrap('<path d="M3 6l5-2 8 2 5-2v14l-5 2-8-2-5 2z"/><path fill="none" d="M8 4v14M16 6v14"/><circle cx="12" cy="11" r="1.6" fill="#b3141e"/>'),
  undo: wrap('<path d="M9 5L3 10.5 9 16v-3.6c4.3-.3 7.6.9 10 4.6-.6-5.5-3.9-9-10-9.6z"/>'),
  moves: wrap('<rect x="4" y="3" width="16" height="18" rx="2"/><path fill="none" d="M8 8h8M8 12h8M8 16h5"/>'),
  pgn: wrap('<path d="M6 3h9l4 4v14H6z"/><path fill="none" d="M15 3v4h4M9 12h7M9 16h7"/>'),
  hint: wrap('<path d="M12 2.8a6.4 6.4 0 0 0-3.8 11.6c.8.6 1.3 1.5 1.3 2.4h5c0-.9.5-1.8 1.3-2.4A6.4 6.4 0 0 0 12 2.8z"/><path d="M9.6 18h4.8v1.6a1.6 1.6 0 0 1-1.6 1.6h-1.6a1.6 1.6 0 0 1-1.6-1.6z"/>'),
  settings: wrap('<path d="M10.3 2.5h3.4l.5 2.6 2.2 1.1 2.3-1.4 2.4 2.4-1.4 2.3 1 2.2 2.7.6v3.4l-2.7.5-1 2.3 1.4 2.3-2.4 2.4-2.3-1.4-2.2 1-.5 2.7h-3.4l-.6-2.7-2.2-1-2.3 1.4-2.4-2.4 1.4-2.3-1-2.3-2.7-.5v-3.4l2.7-.6 1-2.2L4.3 7.2l2.4-2.4L9 6.2l2.2-1.1z"/><circle cx="12" cy="12" r="3.3" fill="#3a2208"/>'),
  pause: wrap('<rect x="6" y="4" width="4.2" height="16" rx="1.2"/><rect x="13.8" y="4" width="4.2" height="16" rx="1.2"/>'),
  flag: wrap('<path fill="none" d="M5 21V3"/><path d="M5 4c4-2 7 2 13 0v9c-6 2-9-2-13 0z"/>'),
  guide: wrap('<path d="M12 2.5l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 8.8l6-.7z"/><circle cx="12" cy="11.2" r="1.6" fill="#b3141e"/>'),
  bolt: wrap('<path d="M13.5 2L5 13.5h6L9.5 22 19 9.5h-6z"/>'),
  mitre: wrap('<path d="M12 2.5c3.8 2.6 6 5.8 6 9.5v8H6v-8c0-3.7 2.2-6.9 6-9.5z"/><path fill="none" d="M12 6v13M9 12h6"/>'),
  pawn: wrap('<circle cx="12" cy="6.5" r="3.3"/><path d="M9.3 10.5h5.4l1.2 6.5H8.1z"/><path d="M6 21h12v-2.6H6z"/>'),
  shield: wrap('<path d="M12 2.5l8 3v6.2c0 4.6-3.3 8.3-8 9.8-4.7-1.5-8-5.2-8-9.8V5.5z"/><path fill="#b3141e" d="M8.5 9.5l1.8 1.7L12 8l1.7 3.2 1.8-1.7-.8 4.8H9.3z"/>'),
  rotate: wrap('<path fill="none" stroke-width="2.4" stroke="url(#g)" d="M19 12a7 7 0 1 1-2.1-5"/><path d="M20.5 3.5v6h-6z"/>'),
  coach: wrap('<path d="M4 5h16v10H10l-4.5 4v-4H4z"/><circle cx="9" cy="10" r="1.2" fill="#3a2208"/><circle cx="12.5" cy="10" r="1.2" fill="#3a2208"/><circle cx="16" cy="10" r="1.2" fill="#3a2208"/>'),
  speaker: wrap('<path d="M4 9h4l5-4.5v15L8 15H4z"/><path fill="none" stroke-width="1.8" d="M16 8.5a5 5 0 0 1 0 7M18.6 6a8.6 8.6 0 0 1 0 12"/>'),
  speakerOff: wrap('<path d="M4 9h4l5-4.5v15L8 15H4z"/><path fill="none" stroke="#b3141e" stroke-width="2.2" d="M16 9l5 6M21 9l-5 6"/>'),
  home: wrap('<path d="M3 11.5L12 3l9 8.5h-2.6V21h-4.6v-6h-3.6v6H5.6v-9.5z"/>'),
  back: wrap('<path d="M14.5 4L6.5 12l8 8 2.2-2.2L10.9 12l5.8-5.8z"/>'),
  star: wrap('<path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/>'),
  infinity: wrap('<path fill="none" stroke-width="2.6" stroke="url(#g)" d="M12 12c-2-2.6-3.6-4-5.4-4a4 4 0 0 0 0 8c1.8 0 3.4-1.4 5.4-4s3.6-4 5.4-4a4 4 0 0 1 0 8c-1.8 0-3.4-1.4-5.4-4z"/>'),
  crown: wrap('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z"/><circle cx="12" cy="4.6" r="1.4"/><path d="M5 19.5h14"/>'),
  hourglass: wrap('<path d="M6 3h12M6 21h12"/><path d="M7 3c0 5 5 6 5 9s-5 4-5 9h10c0-5-5-6-5-9s5-4 5-9z"/>'),
} as const;

export type IconName = keyof typeof ICONS;
