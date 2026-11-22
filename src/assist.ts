import { isEmpty, normalizeAnswer, validateAnswer } from './answers.js';
import { lintBrief, questionForField } from './lint.js';
import { DEFAULT_QUESTIONS } from './questions.js';
import { toMarkdown } from './render.js';
import type { FollowUp } from './followups.js';
import type { AnswerValue, Answers, Brief, LintIssue, Question } from './types.js';

/** One model call. Providers live at '@pixelatlarge/the-lowdown/ai'; bring your own for a server route. */
export interface CompleteRequest {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  /** The most this one call may spend, in USD, when the provider can enforce it. */
  maxCostUsd?: number;
}
export interface CompleteResult {
  text: string;
  /** What the call cost, when known. Otherwise the estimate is counted. */
  costUsd?: number;
}
export type Complete = (req: CompleteRequest) => Promise<CompleteResult>;

export type AssistStage = 'draft' | 'suggest' | 'followUp';

export interface AssistantOptions {
  complete: Complete;
  /** One model for every stage (per-stage `models` win). */
  model?: string;
  /** Defaults: draft → claude-sonnet-5-5 (reads a whole document); suggest and followUp → claude-haiku-5-5. */
  models?: Partial<Record<AssistStage, string>>;
  /** Spend cap in USD for this assistant's lifetime (one CLI run). Default 0.25. */
  budget?: number;
  questions?: Question[];
}

/** A sharper answer for something the brief check flagged, for the person to accept or skip. */
export interface Rewrite {
  questionId: string;
  /** The question, as the person saw it. */
  label: string;
  /** The brief-check message that prompted it. */
  issue: string;
  current?: AnswerValue;
  suggestion: AnswerValue;
  why?: string;
}

export interface Draft {
  answers: Answers;
  /** Things the model says the person should double-check. */
  notes: string[];
}

/** Dollars with enough precision to be meaningful for tiny amounts. */
export const usd = (v: number) => `$${v > 0 && v < 0.01 ? v.toFixed(3) : v.toFixed(2)}`;

export class BudgetError extends Error {
  constructor(readonly spent: number, readonly budget: number, readonly estimate: number) {
    super(`AI budget reached: ${usd(spent)} spent, the next step would cost about ${usd(estimate)}, and the budget is ${usd(budget)}.`);
    this.name = 'BudgetError';
  }
}

export const DEFAULT_MODELS: Record<AssistStage, string> = {
  draft: 'claude-sonnet-5-5',
  suggest: 'claude-haiku-5-5',
  followUp: 'claude-haiku-5-5',
};

/** USD per million tokens [input, output]. Conservative list prices, used for estimates and the budget cap. */
export const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
  'claude-haiku-4-5': [1, 5],
  'claude-sonnet-4-5': [3, 15],
};
const UNKNOWN_PRICE: [number, number] = [10, 50];

export function priceFor(model: string): [number, number] {
  const key = Object.keys(PRICES).find((k) => model === k || model.startsWith(`${k}-`) || model.startsWith(`${k}@`));
  return key ? PRICES[key]! : UNKNOWN_PRICE;
}

/** Cost of a call in USD from token counts. */
export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const [i, o] = priceFor(model);
  return (inputTokens * i + outputTokens * o) / 1_000_000;
}

/** Upper-bound estimate before a call: ~3 characters per token, and every output token used. */
export function estimateCost(req: Pick<CompleteRequest, 'system' | 'user' | 'model' | 'maxTokens'>): number {
  return costOf(req.model, Math.ceil((req.system.length + req.user.length) / 3), req.maxTokens);
}

/** Pull the first JSON object out of a model reply (tolerates code fences and prose around it). */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch { /* fall through */ }
    }
    throw new Error(`The model did not return JSON. It said: "${t.replace(/\s+/g, ' ').slice(0, 200)}"`);
  }
}

const SHAPES = [
  'Value shapes by question type: text and longtext → a string; list → an array of short strings;',
  'select → one choice "value"; multiselect → an array of choice "value"s; confirm → true or false;',
  'scale → a whole number between min and max; rank → the items in priority order.',
].join(' ');

/** A compact question list for a prompt: only what the model needs to shape a value. */
function describeQuestions(qs: Question[]): string {
  return JSON.stringify(
    qs.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      ...(q.choices ? { choices: q.choices.map((c) => ({ value: c.value, label: c.label })) } : {}),
      ...(q.allowOther ? { allowOther: true } : {}),
      ...(q.max !== undefined ? { max: q.max } : {}),
      ...(q.min !== undefined ? { min: q.min } : {}),
    })),
  );
}

/** Shape a model's value for a question, or undefined when it doesn't fit. */
export function coerceAnswer(q: Question, raw: unknown, answers: Answers = {}): AnswerValue | undefined {
  if (raw === null || raw === undefined) return undefined;
  let v: AnswerValue;
  if (Array.isArray(raw)) v = raw.filter((x) => typeof x === 'string' || typeof x === 'number').map(String);
  else if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') v = raw;
  else return undefined;
  try {
    const normalized = normalizeAnswer(q, v, answers);
    if (isEmpty(normalized)) return undefined;
    return validateAnswer(q, normalized, answers) === true ? normalized : undefined;
  } catch {
    return undefined;
  }
}

const same = (a: AnswerValue | undefined, b: AnswerValue | undefined) => JSON.stringify(a) === JSON.stringify(b);

export interface Assistant {
  /** USD spent so far (actual where the provider reports it, estimated otherwise). */
  readonly spent: number;
  readonly budget: number;
  modelFor(stage: AssistStage): string;
  /** Draft answers from a PRD, README or page. Only answers the document supports; the person confirms them. */
  draftAnswers(text: string, opts?: { source?: string; questions?: Question[] }): Promise<Draft>;
  /** A sharper answer for each weak spot the brief check flags. */
  suggestRewrites(brief: Brief, answers: Answers, issues?: LintIssue[]): Promise<Rewrite[]>;
  /** A follow-up question tailored to this answer (falls back to the offline one in the caller). */
  followUpQuestion(followUp: FollowUp, value: AnswerValue, answers: Answers): Promise<string>;
  /** Fold a follow-up reply into the original answer. */
  mergeFollowUp(followUp: FollowUp, value: AnswerValue, question: string, reply: string, answers: Answers): Promise<AnswerValue>;
}

/** Wrap any model call in the-lowdown's prompts, answer validation and a spend cap. */
export function createAssistant(opts: AssistantOptions): Assistant {
  const questions = opts.questions ?? DEFAULT_QUESTIONS;
  const budget = opts.budget ?? 0.25;
  let spent = 0;
  const modelFor = (stage: AssistStage) => opts.models?.[stage] ?? opts.model ?? DEFAULT_MODELS[stage];
  const q = (id: string, qs = questions) => qs.find((x) => x.id === id);

  async function call(stage: AssistStage, system: string, user: string, maxTokens: number): Promise<string> {
    const model = modelFor(stage);
    const estimate = estimateCost({ system, user, model, maxTokens });
    if (spent + estimate > budget) throw new BudgetError(spent, budget, estimate);
    const res = await opts.complete({ system, user, model, maxTokens, maxCostUsd: Math.max(0.01, budget - spent) });
    spent += res.costUsd ?? estimate;
    return res.text;
  }

  async function callJson(stage: AssistStage, system: string, user: string, maxTokens: number): Promise<Record<string, unknown>> {
    const first = await call(stage, system, user, maxTokens);
    try {
      return extractJson(first) as Record<string, unknown>;
    } catch (err) {
      const retry = await call(stage, system, `${user}\n\nYour previous reply was not valid JSON. Reply again with ONLY the JSON object, no prose or code fences.`, maxTokens);
      try {
        return extractJson(retry) as Record<string, unknown>;
      } catch {
        throw err;
      }
    }
  }

  return {
    get spent() { return spent; },
    budget,
    modelFor,

    async draftAnswers(text, o = {}) {
      const qs = (o.questions ?? questions).filter((x) => x.type !== 'rank');
      const doc = text.length > 60_000 ? `${text.slice(0, 60_000)}\n[…cut for length]` : text;
      const system = [
        'You read a product document (a PRD, README or web page) and pre-fill a design-brief questionnaire.',
        'Answer a question only when the document clearly supports it, and leave everything else out. Never invent users, numbers, requirements or a tech stack.',
        'Keep the document\'s own wording where you can, trimmed to what a designer needs. Keep list items short.',
        SHAPES,
        'Reply with JSON only: {"answers": {"<question id>": <value>}, "notes": ["<short note on anything the person should double-check>"]}.',
      ].join('\n');
      const user = `<questions>${describeQuestions(qs)}</questions>\n<document${o.source ? ` source="${o.source.replace(/"/g, '')}"` : ''}>\n${doc}\n</document>`;
      const json = await callJson('draft', system, user, 3000);
      const raw = (json.answers && typeof json.answers === 'object' ? json.answers : {}) as Record<string, unknown>;
      const answers: Answers = {};
      for (const [id, value] of Object.entries(raw)) {
        const question = q(id, qs);
        if (!question) continue;
        const v = coerceAnswer(question, value, answers);
        if (v !== undefined) answers[id] = v;
      }
      const notes = Array.isArray(json.notes) ? json.notes.filter((n): n is string => typeof n === 'string' && n.trim() !== '').slice(0, 5) : [];
      return { answers, notes };
    },

    async suggestRewrites(brief, answers, issues = lintBrief(brief)) {
      const targets = issues
        .map((i) => ({ issue: i, question: q(questionForField(i.field) ?? '') }))
        .filter((t): t is { issue: LintIssue; question: Question } => Boolean(t.question));
      if (!targets.length) return [];
      const system = [
        'You help tighten a design brief that an AI coding agent will follow.',
        'For each flagged answer, write a sharper replacement the person can accept as is. Keep their intent and their facts.',
        'Prefer observable behaviour ("A first-time member books without help") to adjectives. Don\'t invent numbers they couldn\'t know: when a number would help, put a guess in square brackets, like "in under [60] seconds", so they can adjust it.',
        'For list questions, return the whole list with the weak items replaced or the missing items added. Keep each item short.',
        SHAPES,
        'Reply with JSON only: {"rewrites": [{"id": "<question id>", "value": <value>, "why": "<one short sentence>"}]}. Skip any you can\'t improve.',
      ].join('\n');
      const flagged = targets.map((t) => ({ id: t.question.id, issue: t.issue.message, current: answers[t.question.id] ?? null }));
      const user = [
        `<questions>${describeQuestions([...new Set(targets.map((t) => t.question))])}</questions>`,
        `<flagged>${JSON.stringify(flagged)}</flagged>`,
        `<brief>\n${toMarkdown(brief, { instructions: false, checklist: false })}\n</brief>`,
      ].join('\n');
      const json = await callJson('suggest', system, user, 1500);
      const list = Array.isArray(json.rewrites) ? json.rewrites : [];
      const out: Rewrite[] = [];
      for (const r of list as Array<{ id?: unknown; value?: unknown; why?: unknown }>) {
        const t = targets.find((x) => x.question.id === r.id);
        if (!t || out.some((o) => o.questionId === t.question.id)) continue;
        const suggestion = coerceAnswer(t.question, r.value, answers);
        if (suggestion === undefined || same(suggestion, answers[t.question.id])) continue;
        out.push({
          questionId: t.question.id,
          label: t.question.prompt,
          issue: t.issue.message,
          current: answers[t.question.id],
          suggestion,
          why: typeof r.why === 'string' ? r.why : undefined,
        });
      }
      return out;
    },

    async followUpQuestion(followUp, value, answers) {
      const question = q(followUp.questionId);
      const system = [
        'You are a design lead interviewing someone for a brief. Their answer is too vague to design from.',
        'Write ONE short follow-up question (under 20 words) that would make it specific. Plain, friendly words. No preamble, no yes/no questions.',
        'Reply with JSON only: {"question": "..."}',
      ].join('\n');
      const user = JSON.stringify({ project: answers.name, summary: answers.summary, question: question?.prompt, answer: value, focus: followUp.item, problem: followUp.reason });
      const json = await callJson('followUp', system, user, 200);
      const text = typeof json.question === 'string' ? json.question.trim() : '';
      if (!text) throw new Error('The model did not return a question.');
      return text;
    },

    async mergeFollowUp(followUp, value, followUpQuestion, reply, answers) {
      const question = q(followUp.questionId);
      if (!question || !reply.trim()) return value;
      const system = [
        'Combine a person\'s original answer and their reply to a follow-up question into one improved answer for the original question.',
        'Use their words. Don\'t add facts they didn\'t give. Keep it as short as the question needs.',
        'For list questions, return the whole list with the vague item replaced.',
        SHAPES,
        'Reply with JSON only: {"value": <value>}',
      ].join('\n');
      const user = JSON.stringify({ question: { id: question.id, type: question.type, prompt: question.prompt }, original: value, followUp: followUpQuestion, reply });
      const json = await callJson('followUp', system, user, 400);
      return coerceAnswer(question, json.value, answers) ?? followUp.merge(value, reply);
    },
  };
}
