import { DEFAULT_QUESTIONS, SECTIONS } from './questions.js';
import type { AnswerValue, Answers, Choice, Condition, OutputFormat, Question, QuestionType, Section, ToneGuidance } from './types.js';

/** Reword, translate or retune a built-in question. */
export interface QuestionOverride {
  prompt?: string;
  help?: string;
  example?: string;
  /** Relabel choices by value, e.g. { "sketch": "Boceto" }. */
  choiceLabels?: Record<string, string>;
  /** Relabel choice hints by value. */
  choiceHints?: Record<string, string>;
  minLabel?: string;
  maxLabel?: string;
  required?: boolean;
  quick?: boolean;
  default?: AnswerValue;
}

/** A question added by the config. Same shape as Question, minus functions. */
export type ConfigQuestion = Omit<Question, 'when' | 'validate'> & {
  /** Insert after this question id. Default: the end of its section. */
  after?: string;
};

/**
 * A team's shared setup, usually in `.lowdownrc.json` at the project root.
 * Every field is optional.
 */
export interface LowdownConfig {
  /** Ask only the essential questions. */
  quick?: boolean;
  /** Where the brief is written, and in which format. */
  out?: string;
  format?: OutputFormat;
  /** Link the brief from agent instruction files after writing: true, or a list such as ["claude", "cursor"]. */
  link?: boolean | string[];
  /** Include the agent instructions / definition of done sections. */
  instructions?: boolean;
  checklist?: boolean;
  /** Pre-selected answers people can accept with Enter or change. */
  defaults?: Answers;
  /** Fixed answers. These questions are not asked. */
  answers?: Answers;
  /** Question ids never to ask. */
  skip?: string[];
  /** Extra questions, e.g. your team's own. */
  questions?: ConfigQuestion[];
  /** Reword or translate built-in questions, keyed by id. */
  overrides?: Record<string, QuestionOverride>;
  /** Rename sections or add titles for new ones: { "tone": "Look and feel" } or { "brand": { "title": "Brand", "intro": "…" } }. */
  sections?: Record<string, string | { title?: string; intro?: string }>;
  /**
   * Your own tone words, or new meanings for built-in ones, keyed by a short id:
   * { "cozy": { "label": "Cozy", "hint": "soft and homey", "do": "…", "avoid": "…" } }.
   */
  tones?: Record<string, ToneGuidance>;
  /**
   * Optional AI help (drafting from --from, rewrite suggestions, tailored follow-ups).
   * Uses ANTHROPIC_API_KEY, or a Claude Code login. `false` turns it off.
   */
  ai?: false | { model?: string; models?: { draft?: string; suggest?: string; followUp?: string }; budget?: number };
  /** Ask one more question when an answer is vague. Default: on in a terminal. */
  followUps?: boolean;
}

const TYPES: QuestionType[] = ['text', 'longtext', 'list', 'select', 'multiselect', 'confirm', 'scale', 'rank'];

/** Problems that would make a config misbehave. Empty when it is fine. */
export function validateConfig(config: unknown, base: Question[] = DEFAULT_QUESTIONS): string[] {
  const errors: string[] = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return ['The config must be a JSON object.'];
  const c = config as LowdownConfig;
  const known = new Set(base.map((q) => q.id));
  const added = new Set<string>();
  for (const [i, q] of (c.questions ?? []).entries()) {
    const where = `questions[${i}]${q?.id ? ` (${q.id})` : ''}`;
    if (!q || typeof q !== 'object') { errors.push(`${where} must be an object.`); continue; }
    if (!q.id || typeof q.id !== 'string') errors.push(`${where} needs an id.`);
    else if (known.has(q.id) || added.has(q.id)) errors.push(`${where}: id "${q.id}" is already used.`);
    else added.add(q.id);
    if (!q.prompt) errors.push(`${where} needs a prompt.`);
    if (!q.section) errors.push(`${where} needs a section.`);
    if (!TYPES.includes(q.type)) errors.push(`${where}: type must be one of ${TYPES.join(', ')}.`);
    if ((q.type === 'select' || q.type === 'multiselect') && !q.choices?.length && !q.allowOther) {
      errors.push(`${where}: ${q.type} needs choices.`);
    }
    if (q.after && !known.has(q.after) && !added.has(q.after)) errors.push(`${where}: "after" refers to an unknown question "${q.after}".`);
  }
  const all = new Set([...known, ...added]);
  for (const key of ['overrides', 'defaults', 'answers'] as const) {
    for (const id of Object.keys(c[key] ?? {})) {
      if (!all.has(id)) errors.push(`${key}.${id}: no question has that id.`);
    }
  }
  for (const id of c.skip ?? []) {
    const q = base.find((x) => x.id === id);
    if (!q) errors.push(`skip: no question has the id "${id}".`);
    else if (q.required && c.answers?.[id] === undefined) errors.push(`skip: "${id}" is required; give it a fixed value in "answers" instead.`);
  }
  if (c.format && !['markdown', 'prompt', 'json', 'html'].includes(c.format)) errors.push('format must be markdown, prompt, json or html.');
  if (c.ai !== undefined && c.ai !== false) {
    if (typeof c.ai !== 'object' || Array.isArray(c.ai)) errors.push('ai must be false or an object.');
    else {
      if (c.ai.budget !== undefined && !(typeof c.ai.budget === 'number' && c.ai.budget >= 0)) errors.push('ai.budget must be a number of US dollars, e.g. 0.25.');
      for (const k of Object.keys(c.ai.models ?? {})) if (!['draft', 'suggest', 'followUp'].includes(k)) errors.push(`ai.models.${k}: use draft, suggest or followUp.`);
    }
  }
  if (c.followUps !== undefined && typeof c.followUps !== 'boolean') errors.push('followUps must be true or false.');
  for (const [key, t] of Object.entries(c.tones ?? {})) {
    if (!t || typeof t !== 'object' || !t.label || !t.do || !t.avoid) errors.push(`tones.${key} needs a label, do and avoid.`);
  }
  return errors;
}

/**
 * Apply a config to the question set: overrides, added questions, skips and
 * defaults. Returns the questions, sections and fixed answers to start a
 * session with. Pure, so it works in the browser too.
 */
export function applyConfig(
  config: LowdownConfig,
  base: { questions?: Question[]; sections?: Section[] } = {},
): { questions: Question[]; sections: Section[]; answers: Answers; toneGuidance: Record<string, ToneGuidance> } {
  const skip = new Set(config.skip ?? []);
  let questions: Question[] = (base.questions ?? DEFAULT_QUESTIONS)
    .filter((q) => !skip.has(q.id))
    .map((q) => {
      const o = config.overrides?.[q.id];
      const d = config.defaults?.[q.id];
      if (!o && d === undefined) return q;
      const choices: Choice[] | undefined = q.choices?.map((ch) => ({
        ...ch,
        label: o?.choiceLabels?.[ch.value] ?? ch.label,
        hint: o?.choiceHints?.[ch.value] ?? ch.hint,
      }));
      return {
        ...q,
        ...(o?.prompt !== undefined && { prompt: o.prompt }),
        ...(o?.help !== undefined && { help: o.help }),
        ...(o?.example !== undefined && { example: o.example }),
        ...(o?.minLabel !== undefined && { minLabel: o.minLabel }),
        ...(o?.maxLabel !== undefined && { maxLabel: o.maxLabel }),
        ...(o?.required !== undefined && { required: o.required }),
        ...(o?.quick !== undefined && { quick: o.quick }),
        ...(choices && { choices }),
        ...(o?.default !== undefined && { default: o.default }),
        ...(d !== undefined && { default: d }),
      };
    });

  // Custom tone words become choices on the tone question.
  const tones = Object.entries(config.tones ?? {});
  if (tones.length) {
    questions = questions.map((q) => {
      if (q.id !== 'tone') return q;
      const choices = [...(q.choices ?? [])];
      for (const [value, t] of tones) {
        const i = choices.findIndex((c) => c.value === value);
        const choice = { value, label: t.label, hint: t.hint ?? t.do.split(/[,.]/)[0] };
        if (i >= 0) choices[i] = choice;
        else choices.push(choice);
      }
      return { ...q, choices };
    });
  }

  for (const added of config.questions ?? []) {
    const { after, ...q } = added;
    const question: Question = { ...q, ...(config.defaults?.[q.id] !== undefined && { default: config.defaults[q.id] }) };
    let at = after ? questions.findIndex((x) => x.id === after) + 1 : 0;
    if (!after || at === 0) {
      const lastInSection = questions.map((x) => x.section).lastIndexOf(q.section);
      at = lastInSection >= 0 ? lastInSection + 1 : questions.length;
    }
    questions = [...questions.slice(0, at), question, ...questions.slice(at)];
  }

  const sections: Section[] = (base.sections ?? SECTIONS).map((s) => {
    const o = config.sections?.[s.id];
    if (o === undefined) return s;
    return typeof o === 'string' ? { ...s, title: o } : { ...s, ...o };
  });
  for (const [id, o] of Object.entries(config.sections ?? {})) {
    if (!sections.some((s) => s.id === id)) {
      sections.push(typeof o === 'string' ? { id, title: o } : { id, title: o.title ?? id, intro: o.intro });
    }
  }

  return { questions, sections, answers: { ...(config.answers ?? {}) }, toneGuidance: { ...(config.tones ?? {}) } };
}

export type { Condition };
