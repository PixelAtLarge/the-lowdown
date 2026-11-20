import { isEmpty, normalizeAnswer, parseInput, validateAnswer } from './answers.js';
import { buildBrief } from './brief.js';
import { DEFAULT_QUESTIONS, SECTIONS } from './questions.js';
import type { AnswerValue, Answers, Brief, Question, Section } from './types.js';

export interface SessionOptions {
  /** Defaults to DEFAULT_QUESTIONS. */
  questions?: Question[];
  /** Pre-filled answers; those questions are not asked. */
  answers?: Answers;
  /** Only ask required questions and those marked `quick`. */
  quick?: boolean;
}

export type AnswerResult = { ok: true } | { ok: false; error: string };

/**
 * A headless, UI-agnostic interview. Drive it from a CLI, a React form, or a
 * chat agent: read `current()`, call `answer()` / `skip()` / `back()`, and
 * call `toBrief()` when `isComplete`.
 */
export class BriefSession {
  readonly questions: Question[];
  readonly sections: Section[];
  readonly quick: boolean;
  private readonly _answers: Answers;
  private readonly skipped = new Set<string>();
  private readonly drafts: Answers = {};
  private readonly history: string[] = [];

  constructor(opts: SessionOptions = {}) {
    this.questions = opts.questions ?? DEFAULT_QUESTIONS;
    this.quick = opts.quick ?? false;
    const extraSections = [...new Set(this.questions.map((q) => q.section))]
      .filter((id) => !SECTIONS.some((s) => s.id === id))
      .map((id) => ({ id, title: titleCase(id) }));
    this.sections = [...SECTIONS, ...extraSections];

    this._answers = {};
    for (const [id, value] of Object.entries(opts.answers ?? {})) {
      const q = this.find(id);
      this._answers[id] = q ? normalizeAnswer(q, value) : value;
    }
  }

  get answers(): Answers {
    return { ...this._answers };
  }

  find(id: string): Question | undefined {
    return this.questions.find((q) => q.id === id);
  }

  /** Questions that apply given quick mode and current answers. */
  applicable(): Question[] {
    return this.questions.filter(
      (q) =>
        (!this.quick || q.required || q.quick) && (q.when ? q.when(this._answers) : true),
    );
  }

  /** The next question to ask, or undefined when done. */
  current(): Question | undefined {
    return this.applicable().find(
      (q) => !(q.id in this._answers) && !this.skipped.has(q.id),
    );
  }

  get isComplete(): boolean {
    return this.current() === undefined;
  }

  progress(): { index: number; total: number } {
    const all = this.applicable();
    const cur = this.current();
    return { index: cur ? all.indexOf(cur) + 1 : all.length, total: all.length };
  }

  /** True when back() has an earlier question to return to. */
  get canGoBack(): boolean {
    return this.history.length > 0;
  }

  /** The value previously given for a question the user went back to. */
  draft(id: string): AnswerValue | undefined {
    return this.drafts[id];
  }

  /** Answer the current question with a typed value. */
  answer(value: AnswerValue): AnswerResult {
    const q = this.current();
    if (!q) return { ok: false, error: 'No question to answer; the session is complete.' };
    const normalized = normalizeAnswer(q, value);
    const valid = validateAnswer(q, normalized, this._answers);
    if (valid !== true) return { ok: false, error: valid };
    if (isEmpty(normalized)) {
      this.skipped.add(q.id);
    } else {
      this._answers[q.id] = normalized;
    }
    this.history.push(q.id);
    return { ok: true };
  }

  /** Answer the current question from raw typed text (accepts choice numbers). */
  answerText(raw: string): AnswerResult {
    const q = this.current();
    if (!q) return { ok: false, error: 'No question to answer; the session is complete.' };
    return this.answer(parseInput(q, raw));
  }

  /** Skip the current question, using its default if it has one. */
  skip(): AnswerResult {
    const q = this.current();
    if (!q) return { ok: false, error: 'No question to skip.' };
    if (q.default !== undefined) return this.answer(q.default);
    if (q.required) return { ok: false, error: 'This one is required.' };
    this.skipped.add(q.id);
    this.history.push(q.id);
    return { ok: true };
  }

  /** Go back one question. Returns the question that is current again. */
  back(): Question | undefined {
    const id = this.history.pop();
    if (!id) return this.current();
    if (id in this._answers) this.drafts[id] = this._answers[id] as AnswerValue;
    delete this._answers[id];
    this.skipped.delete(id);
    return this.current();
  }

  /** Required questions that apply but have no answer. */
  missingRequired(): Question[] {
    return this.applicable().filter((q) => q.required && isEmpty(this._answers[q.id]));
  }

  toBrief(now: Date = new Date()): Brief {
    const missing = this.missingRequired();
    if (missing.length) {
      throw new Error(`Missing required answers: ${missing.map((q) => q.id).join(', ')}`);
    }
    return buildBrief(this._answers, { questions: this.questions, now });
  }
}

export function titleCase(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}
