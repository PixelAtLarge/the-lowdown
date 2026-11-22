import { CONTENT_CHOICE_LABELS, DEFAULT_QUESTIONS, FIDELITY_LABELS, TONE_GUIDANCE } from './questions.js';
import type { AnswerValue, Answers, Question, ToneGuidance } from './types.js';

// ── Markdown → HTML (the subset the brief uses) ──────────────

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * Convert the Markdown the brief renders (headings, quotes, bold, code,
 * bullet / numbered / task lists, paragraphs) into HTML. Not a general parser.
 */
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const openList = (kind: 'ul' | 'ol') => {
    if (list !== kind) {
      closeList();
      out.push(`<${kind}>`);
      list = kind;
    }
  };

  for (const raw of stripFrontmatter(md).body.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m: RegExpExecArray | null;
    if (!line.trim()) { flushPara(); closeList(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { flushPara(); closeList(); out.push(`<h${m[1]!.length}>${inline(m[2]!)}</h${m[1]!.length}>`); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); closeList(); out.push(`<blockquote>${inline(m[1]!)}</blockquote>`); continue; }
    if ((m = /^[-*]\s+\[[ xX]\]\s+(.*)$/.exec(line))) { flushPara(); openList('ul'); out.push(`<li class="task">${inline(m[1]!)}</li>`); continue; }
    if ((m = /^[-*]\s+(.*)$/.exec(line))) { flushPara(); openList('ul'); out.push(`<li>${inline(m[1]!)}</li>`); continue; }
    if ((m = /^\d+\.\s+(.*)$/.exec(line))) { flushPara(); openList('ol'); out.push(`<li>${inline(m[1]!)}</li>`); continue; }
    closeList();
    para.push(line.trim());
  }
  flushPara();
  closeList();
  return out.join('\n');
}

// ── Front matter ─────────────────────────────────────────────

/** Split a `---` YAML front matter block (simple `key: value` lines) from the body. */
export function stripFrontmatter(md: string): { data: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { data: {}, body: md };
  const data: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2]!.trim();
    if (v.startsWith('"')) { try { v = JSON.parse(v); } catch { /* keep raw */ } }
    data[kv[1]!] = v;
  }
  return { data, body: md.slice(m[0].length) };
}

// ── Reading an (edited) Markdown brief back into answers ─────

export interface ParsedMarkdownBrief {
  answers: Answers;
  /** Guidance for tone words that aren't built in, read from the brief's tone list. */
  toneGuidance: Record<string, ToneGuidance>;
  /** Front matter values, e.g. { brief: 'the-lowdown', created: '2026-11-22' }. */
  meta: Record<string, string>;
}

/** True if the text looks like a brief written by the-lowdown (or edited from one). */
export function isMarkdownBrief(text: string): boolean {
  const { data, body } = stripFrontmatter(text);
  return data.brief === 'the-lowdown' || /^#\s+Design brief:/m.test(body);
}

const clean = (s: string) => s.replace(/\s+$/, '').trim();
const splitComma = (s: string) => s.split(/,\s+/).map((x) => x.trim()).filter(Boolean);
const unlabel = (q: Question | undefined, label: string) =>
  q?.choices?.find((c) => c.label.toLowerCase() === label.toLowerCase() || c.value.toLowerCase() === label.toLowerCase())?.value ?? label;
const promptLabel = (q: Question) => q.prompt.replace(/\?$/, '');

interface Block {
  section: string;
  label: string;
  /** Single-line value after "**Label:**", if any. */
  value?: string;
  /** Items of the list that followed the label. */
  items: string[];
  ordered?: boolean;
}

/**
 * Read a Markdown brief (as written by toMarkdown, possibly edited by hand)
 * back into answers. Unknown lines are ignored, so light edits are safe.
 */
export function parseMarkdownBrief(md: string, questions: Question[] = DEFAULT_QUESTIONS): ParsedMarkdownBrief {
  const { data: meta, body } = stripFrontmatter(md);
  const answers: Answers = {};
  const toneGuidance: Record<string, ToneGuidance> = {};
  const lines = body.split(/\r?\n/);
  const q = (id: string) => questions.find((x) => x.id === id);

  // 1. Collect labelled fields and the lists under them, per section.
  const blocks: Block[] = [];
  const toneLines: string[] = [];
  let section = '';
  let current: Block | undefined;
  for (const raw of lines) {
    const line = clean(raw);
    let m: RegExpExecArray | null;
    if ((m = /^#\s+Design brief:\s*(.+)$/.exec(line))) { answers.name = m[1]!.trim(); continue; }
    if ((m = /^##\s+(.+)$/.exec(line))) { section = m[1]!.replace(/\s*\(.*\)\s*$/, '').trim().toLowerCase(); current = undefined; continue; }
    if (!section && (m = /^>\s?(.+)$/.exec(line))) { answers.summary = (answers.summary ? `${answers.summary} ` : '') + m[1]!.trim(); continue; }
    if (!section && /\*\*Type:\*\*|\*\*Fidelity:\*\*/.test(line)) {
      for (const part of line.split('·')) {
        const kv = /\*\*(Type|Fidelity):\*\*\s*(.+)/.exec(part.trim());
        if (kv?.[1] === 'Type') answers.kind = unlabel(q('kind'), kv[2]!.trim());
        if (kv?.[1] === 'Fidelity') answers.fidelity = FIDELITY_LABELS[kv[2]!.trim().toLowerCase()] ?? kv[2]!.trim();
      }
      continue;
    }
    if (section === 'tone' && /^[-*]\s+\*\*[^*]+\.\*\*\s+Do:/.test(line)) { toneLines.push(line); continue; }
    if ((m = /^\*\*([^*]+?):?\*\*:?\s*(?:\((.*)\):?)?\s*(.*)$/.exec(line))) {
      // "**Label:** value", "**Label:**" (list follows) or "**Success looks like** (in priority order…):"
      current = { section, label: m[1]!.replace(/:$/, '').trim(), value: m[3]?.trim() || undefined, items: [], ordered: Boolean(m[2] && /priority/i.test(m[2])) };
      blocks.push(current);
      continue;
    }
    if ((m = /^(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line)) && current && !current.value) {
      current.items.push(m[1]!.trim());
      if (/^\d+\./.test(line)) current.ordered = current.ordered || current.label.toLowerCase().startsWith('success');
      continue;
    }
  }

  // Prefer the expected section, but accept a known label anywhere: hand edits drift.
  const find = (sec: string, label: RegExp) =>
    blocks.find((b) => b.section === sec && label.test(b.label)) ?? blocks.find((b) => label.test(b.label));
  const text = (sec: string, label: RegExp) => find(sec, label)?.value;
  const listOf = (sec: string, label: RegExp) => {
    const b = find(sec, label);
    return b ? (b.items.length ? b.items : b.value ? [b.value] : []) : undefined;
  };
  const set = (id: string, v: AnswerValue | undefined) => {
    if (v === undefined || (Array.isArray(v) && !v.length) || v === '') return;
    answers[id] = v;
  };

  // 2. Map known labels back to answers.
  set('primaryUsers', text('users', /^primary user$/i));
  set('userContext', text('users', /^their situation$/i));
  set('secondaryUsers', listOf('users', /^also used by/i));
  set('accessibility', listOf('users', /^accessibility/i));

  const success = find('goals', /^success looks like/i);
  if (success) {
    set('goals', success.items);
    if (success.ordered && success.items.length > 1) set('goalPriority', success.items);
  }
  const action = text('goals', /^primary action$/i);
  set('primaryAction', action?.replace(/\.\s*Give it the strongest visual weight.*$/i, '').trim());
  set('nonGoals', listOf('goals', /^out of scope/i));

  const platforms = text('constraints', /^platforms$/i);
  if (platforms) set('platforms', splitComma(platforms).map((p) => unlabel(q('platforms'), p)));
  set('stack', text('constraints', /^stack/i));
  const fid = find('constraints', /^fidelity/i);
  if (fid && !answers.fidelity) {
    const label = /^Fidelity \((.+)\)$/.exec(fid.label)?.[1] ?? fid.value ?? '';
    answers.fidelity = FIDELITY_LABELS[label.toLowerCase()] ?? label;
  }
  const content = blocks.find((b) => b.section === 'constraints' && /^content/i.test(b.label));
  const contentLabel = content && /^Content \((.+)\)$/.exec(content.label)?.[1];
  if (contentLabel) set('content', CONTENT_CHOICE_LABELS[contentLabel.toLowerCase()] ?? contentLabel);
  set('brandAssets', listOf('constraints', /^brand assets$/i));
  set('crossCutting', listOf('constraints', /^applies everywhere/i)?.map((c) => unlabel(q('crossCutting'), c)));
  set('mustInclude', listOf('constraints', /^must include$/i));
  set('mustAvoid', listOf('constraints', /^must avoid$/i));

  // Tone words: built-in labels map to their keys; custom words with guidance get a slug key.
  const builtInKey = (label: string) => Object.entries(TONE_GUIDANCE).find(([, g]) => g.label.toLowerCase() === label.toLowerCase())?.[0];
  const slug = (label: string) => label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const guidanceKeys = new Map<string, string>();
  for (const l of toneLines) {
    const m = /^[-*]\s+\*\*([^*]+)\.\*\*\s+Do:\s*(.*?)\s+Avoid:\s*(.*)$/.exec(l);
    if (!m) continue;
    const label = m[1]!.trim();
    const key = builtInKey(label) ?? (q('tone')?.choices?.some((c) => c.label === label) ? unlabel(q('tone'), label) : slug(label));
    guidanceKeys.set(label.toLowerCase(), key);
    const builtIn = TONE_GUIDANCE[key];
    // Keep guidance only when it differs from the built-in words (custom or edited).
    if (!builtIn || builtIn.do !== m[2] || builtIn.avoid !== m[3]) toneGuidance[key] = { label, do: m[2]!, avoid: m[3]! };
  }
  const feel = text('tone', /^should feel$/i);
  if (feel) {
    set('tone', splitComma(feel).map((label) => builtInKey(label) ?? guidanceKeys.get(label.toLowerCase()) ?? unlabel(q('tone'), label)));
  }
  const refs = listOf('tone', /^references$/i);
  if (refs) set('references', refs.map((r) => r.replace(/^\*\*(.+?):\*\*\s*borrow\s+(.+)$/i, '$1 — $2')));
  set('antiTone', text('tone', /^must never feel like$/i));

  // 3. Project specifics and custom questions, matched by their prompt.
  const handled = new Set(['primary user', 'their situation', 'primary action', 'platforms', 'should feel', 'must never feel like', 'references']);
  for (const qn of questions) {
    if (qn.id in answers) continue;
    const label = promptLabel(qn).toLowerCase();
    if (handled.has(label)) continue;
    const b = blocks.find((x) => x.label.toLowerCase() === label);
    if (!b) continue;
    const raw = b.items.length ? b.items : b.value ? [b.value] : [];
    if (!raw.length) continue;
    switch (qn.type) {
      case 'list':
      case 'rank':
        set(qn.id, b.items.length ? b.items : splitComma(raw[0]!));
        break;
      case 'multiselect':
        set(qn.id, (b.items.length ? b.items : splitComma(raw[0]!)).map((x) => unlabel(qn, x)));
        break;
      case 'select':
        set(qn.id, unlabel(qn, raw[0]!));
        break;
      case 'confirm':
        set(qn.id, /^yes$/i.test(raw[0]!));
        break;
      case 'scale': {
        const n = parseInt(raw[0]!, 10);
        if (!Number.isNaN(n)) set(qn.id, n);
        break;
      }
      default:
        set(qn.id, raw.join(', '));
    }
  }

  return { answers, toneGuidance, meta };
}
