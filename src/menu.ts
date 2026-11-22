/**
 * Arrow-key menus for the terminal, as a pure state machine so it can be
 * tested without a TTY. The CLI feeds it keypresses and prints renderMenu().
 */

export interface MenuItem {
  value: string;
  label: string;
  hint?: string;
}

/** single: pick one · multi: pick several · order: pick in priority order. */
export type MenuMode = 'single' | 'multi' | 'order';

export interface MenuState {
  mode: MenuMode;
  items: MenuItem[];
  cursor: number;
  /** Picked values. For 'order', in the order they were picked. */
  picked: string[];
  max?: number;
  /** Adds a final "Type your own…" row. */
  allowOther?: boolean;
  /** Adds a "Skip" row (single) or lets Enter submit nothing (multi). */
  optional?: boolean;
  /** Last message to show under the menu, e.g. "Pick at most 3". */
  note?: string;
}

export type MenuKey =
  | { name: 'up' | 'down' | 'space' | 'enter' | 'back' | 'help' | 'home' | 'end' }
  | { name: 'digit'; digit: number };

export type MenuResult =
  | { action: 'submit'; value: string | string[] }
  | { action: 'skip' }
  | { action: 'back' }
  | { action: 'help' }
  | { action: 'other'; picked: string[] };

const OTHER = '\u0000other';
const SKIP = '\u0000skip';

export function createMenu(opts: Omit<MenuState, 'cursor' | 'picked'> & { picked?: string[] }): MenuState {
  const picked = (opts.picked ?? []).filter((p) => opts.items.some((i) => i.value === p));
  const first = opts.mode === 'single' && picked[0] ? opts.items.findIndex((i) => i.value === picked[0]) : 0;
  return { ...opts, picked, cursor: Math.max(0, first) };
}

/** Every row, including the extra "Type your own" and "Skip" rows. */
export function menuRows(s: MenuState): MenuItem[] {
  const rows = [...s.items];
  if (s.allowOther) rows.push({ value: OTHER, label: 'Type your own…' });
  if (s.optional && s.mode === 'single') rows.push({ value: SKIP, label: 'Skip' });
  return rows;
}

export function menuReducer(s: MenuState, key: MenuKey): { state: MenuState; result?: MenuResult } {
  const rows = menuRows(s);
  const at = rows[s.cursor];
  const move = (cursor: number) => ({ state: { ...s, cursor: (cursor + rows.length) % rows.length, note: undefined } });

  switch (key.name) {
    case 'up':
      return move(s.cursor - 1);
    case 'down':
      return move(s.cursor + 1);
    case 'home':
      return move(0);
    case 'end':
      return move(rows.length - 1);
    case 'digit': {
      const i = key.digit - 1;
      if (i < 0 || i >= s.items.length) return { state: s };
      const next = { ...s, cursor: i };
      return s.mode === 'single' ? { state: next } : menuReducer(next, { name: 'space' });
    }
    case 'back':
      return { state: s, result: { action: 'back' } };
    case 'help':
      return { state: s, result: { action: 'help' } };
    case 'space': {
      if (!at || at.value === SKIP) return { state: s };
      if (at.value === OTHER) return { state: s, result: { action: 'other', picked: s.picked } };
      if (s.mode === 'single') return { state: { ...s, picked: [at.value] } };
      if (s.picked.includes(at.value)) return { state: { ...s, picked: s.picked.filter((p) => p !== at.value), note: undefined } };
      if (s.max && s.picked.length >= s.max) return { state: { ...s, note: `Pick at most ${s.max}.` } };
      return { state: { ...s, picked: [...s.picked, at.value], note: undefined } };
    }
    case 'enter': {
      if (s.mode === 'single') {
        if (!at) return { state: s };
        if (at.value === OTHER) return { state: s, result: { action: 'other', picked: [] } };
        if (at.value === SKIP) return { state: s, result: { action: 'skip' } };
        return { state: { ...s, picked: [at.value] }, result: { action: 'submit', value: at.value } };
      }
      if (at?.value === OTHER) return { state: s, result: { action: 'other', picked: s.picked } };
      if (!s.picked.length) {
        if (s.optional) return { state: s, result: { action: 'skip' } };
        return { state: { ...s, note: s.mode === 'order' ? 'Press space on each item, most important first.' : 'Press space to pick at least one.' } };
      }
      if (s.mode === 'multi') {
        const ordered = s.items.map((i) => i.value).filter((v) => s.picked.includes(v));
        return { state: s, result: { action: 'submit', value: ordered } };
      }
      return { state: s, result: { action: 'submit', value: s.picked } };
    }
  }
}

/** Lines to print for the current state. `paint` lets the caller add colour. */
export function renderMenu(
  s: MenuState,
  paint: { dim: (x: string) => string; cyan: (x: string) => string; bold: (x: string) => string } = {
    dim: (x) => x,
    cyan: (x) => x,
    bold: (x) => x,
  },
): string[] {
  const lines = menuRows(s).map((row, i) => {
    const here = i === s.cursor;
    const pointer = here ? paint.cyan('›') : ' ';
    let mark = '';
    if (row.value !== OTHER && row.value !== SKIP) {
      if (s.mode === 'multi') mark = s.picked.includes(row.value) ? paint.cyan('◉ ') : paint.dim('○ ');
      if (s.mode === 'order') {
        const n = s.picked.indexOf(row.value);
        mark = n >= 0 ? paint.cyan(`${n + 1}`.padStart(2) + ' ') : paint.dim(' · ');
      }
    }
    const label = here ? paint.bold(row.label) : row.value === OTHER || row.value === SKIP ? paint.dim(row.label) : row.label;
    return ` ${pointer} ${mark}${label}${row.hint ? paint.dim(` — ${row.hint}`) : ''}`;
  });
  const keys =
    s.mode === 'single'
      ? '↑↓ move · enter choose'
      : s.mode === 'multi'
        ? `↑↓ move · space pick${s.max ? ` (up to ${s.max})` : ''} · enter done`
        : '↑↓ move · space adds in priority order · enter done';
  lines.push(paint.dim(`   ${keys} · < back · ? help`));
  if (s.note) lines.push(paint.cyan(`   ${s.note}`));
  return lines;
}
