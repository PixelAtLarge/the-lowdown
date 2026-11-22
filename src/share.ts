import type { Answers } from './types.js';

/**
 * Shareable links: answers are stored in the URL itself (no backend), as
 * base64url-encoded JSON with a version prefix so the format can change later.
 */
const PREFIX = 'v1.';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode answers into a compact, URL-safe string. Empty answers are dropped. */
export function encodeAnswers(answers: Answers): string {
  const kept: Answers = {};
  for (const [k, v] of Object.entries(answers)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    kept[k] = v;
  }
  return PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(kept)));
}

/** Decode a string from encodeAnswers(). Throws on anything malformed. */
export function decodeAnswers(token: string): Answers {
  const raw = token.trim();
  if (!raw.startsWith(PREFIX)) throw new Error('Not a the-lowdown share token.');
  const data = JSON.parse(new TextDecoder().decode(fromBase64Url(raw.slice(PREFIX.length))));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Share token has no answers.');
  const out: Answers = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[k] = v as string[];
  }
  return out;
}

/** Build a share URL by putting the encoded answers in the hash (`#a=…`), which never reaches a server. */
export function shareUrl(base: string, answers: Answers): string {
  const url = new URL(base);
  url.hash = `a=${encodeAnswers(answers)}`;
  return url.toString();
}

/** Read answers from a location hash such as `#a=v1.…`. Returns undefined when absent or invalid. */
export function answersFromHash(hash: string): Answers | undefined {
  const m = /(?:^#|&)a=([^&]+)/.exec(hash.startsWith('#') ? hash : `#${hash}`);
  if (!m?.[1]) return undefined;
  try {
    return decodeAnswers(decodeURIComponent(m[1]));
  } catch {
    return undefined;
  }
}
