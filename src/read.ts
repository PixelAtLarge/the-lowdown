import { buildBrief, isBrief } from './brief.js';
import { isMarkdownBrief, parseMarkdownBrief } from './markdown.js';
import { DEFAULT_QUESTIONS } from './questions.js';
import { toMarkdown } from './render.js';
import type { Answers, Brief, Question, ToneGuidance } from './types.js';

export interface ReadOptions {
  questions?: Question[];
  toneGuidance?: Record<string, ToneGuidance>;
}

export interface ReadResult {
  brief: Brief;
  /** Answers that rebuild this brief; use them to edit it. */
  answers: Answers;
  /** Custom tone guidance found in the file. */
  toneGuidance: Record<string, ToneGuidance>;
  source: 'markdown' | 'brief-json' | 'answers-json';
}

/**
 * Read any brief file: a Markdown brief (including one edited by hand), a
 * brief JSON, or an answers JSON. Always returns both the brief and the
 * answers behind it.
 */
export function readBrief(text: string, opts: ReadOptions = {}): ReadResult {
  const questions = opts.questions ?? DEFAULT_QUESTIONS;
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`Not valid JSON: ${(e as Error).message}`);
    }
    if (isBrief(data)) {
      // Round-trip through Markdown to recover the answers behind the brief.
      const parsed = parseMarkdownBrief(toMarkdown(data), questions);
      const toneGuidance = { ...(data.tone.guidance ?? {}), ...parsed.toneGuidance };
      return { brief: data, answers: parsed.answers, toneGuidance, source: 'brief-json' };
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const answers = data as Answers;
      return { brief: buildBrief(answers, { questions, toneGuidance: opts.toneGuidance }), answers, toneGuidance: opts.toneGuidance ?? {}, source: 'answers-json' };
    }
    throw new Error('This JSON is neither a brief nor an answers object.');
  }
  if (!isMarkdownBrief(text)) throw new Error('This doesn\'t look like a brief: expected "# Design brief: …" Markdown, a brief JSON or an answers JSON.');
  const { answers, toneGuidance: found, meta } = parseMarkdownBrief(text, questions);
  const toneGuidance = { ...(opts.toneGuidance ?? {}), ...found };
  const created = meta.created && !Number.isNaN(Date.parse(meta.created)) ? new Date(meta.created) : undefined;
  const brief = buildBrief(answers, { questions, toneGuidance, strict: false, now: created });
  return { brief, answers, toneGuidance, source: 'markdown' };
}
