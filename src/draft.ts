import type { Answers } from './types.js';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

/** Turn an HTML page into rough Markdown-ish text: headings, list items and paragraphs survive. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template|nav|footer)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, t: string) => `\n\n${'#'.repeat(Number(n))} ${t}\n\n`)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|ul|ol|table|tr|blockquote|pre)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface Section {
  heading: string;
  paragraphs: string[];
  items: string[];
}

const plain = (s: string) =>
  s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function sections(text: string): { title?: string; intro: string[]; sections: Section[] } {
  let title: string | undefined;
  const intro: string[] = [];
  const out: Section[] = [];
  let cur: Section | undefined;
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const p = plain(para.join(' '));
    para = [];
    if (!p) return;
    (cur ? cur.paragraphs : intro).push(p);
  };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = /^#\s+(.+)$/.exec(line)) && !title && !cur) { flush(); title = plain(m[1]!); continue; }
    if ((m = /^#{1,4}\s+(.+)$/.exec(line))) { flush(); cur = { heading: plain(m[1]!), paragraphs: [], items: [] }; out.push(cur); continue; }
    if ((m = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line))) {
      flush();
      const item = plain(m[1]!);
      if (item && cur) cur.items.push(item);
      continue;
    }
    if (!line || /^(<|\[!\[|!\[|---|===|```)/.test(line)) { flush(); continue; }
    para.push(line);
  }
  flush();
  return { title, intro, sections: out };
}

const firstSentences = (p: string, max = 240) => {
  const parts = p.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [p];
  let out = '';
  for (const s of parts) {
    if ((out + s).length > max && out) break;
    out += s;
  }
  return out.trim() || p.slice(0, max).trim();
};

/**
 * Draft answers from a PRD, README or web page without AI: the title, the
 * opening paragraph, and lists under headings such as "Goals", "Users" or
 * "Out of scope". Only what's clearly there; the person confirms each one.
 */
export function draftFromText(text: string): Answers {
  const doc = sections(/<\/?[a-z][\s\S]*>/i.test(text) && /<(html|body|p|div|h1)\b/i.test(text) ? htmlToText(text) : text);
  const answers: Answers = {};
  const find = (re: RegExp) => doc.sections.find((s) => re.test(s.heading));

  if (doc.title) answers.name = doc.title.replace(/^(prd|product requirements?( document)?|spec|brief|design brief)\s*[:—–-]\s*/i, '').trim();
  const opening = doc.intro.find((p) => p.split(' ').length >= 6) ?? find(/^(overview|summary|about|introduction|what is)/i)?.paragraphs[0];
  if (opening) answers.summary = firstSentences(opening);

  const outOfScope = find(/non[- ]?goals|out of scope|not in scope|won'?t do|not doing/i);
  if (outOfScope?.items.length) answers.nonGoals = outOfScope.items.slice(0, 8);

  const goals = doc.sections.find((s) => s !== outOfScope && /\b(goals?|success|objectives?|outcomes?|metrics|kpis?)\b/i.test(s.heading));
  if (goals?.items.length) answers.goals = goals.items.slice(0, 6);

  const users = find(/\b(users?|audience|personas?|customers?|who (it'?s|is it) for)\b/i);
  const who = users?.paragraphs[0] ?? users?.items[0];
  if (who) answers.primaryUsers = firstSentences(who, 160);

  const stack = find(/\b(tech(nical)? stack|stack|built with|technology|tech)\b/i);
  const stackText = stack?.items.length ? stack.items.slice(0, 4).join(', ') : stack?.paragraphs[0];
  if (stackText) answers.stack = firstSentences(stackText, 160);

  const musts = find(/\b(requirements?|must[- ]haves?|features|scope)\b/i);
  if (musts && musts !== outOfScope && musts.items.length) answers.mustInclude = musts.items.slice(0, 8);

  return answers;
}
