import { isApplicable, isEmpty, normalizeAnswer, validateAnswer } from './answers.js';
import { BUILT_IN_IDS, DEFAULT_QUESTIONS } from './questions.js';
import type { AnswerValue, Answers, Brief, ExtraField, Question, Reference, ToneGuidance } from './types.js';

export interface BuildOptions {
  questions?: Question[];
  now?: Date;
  /** Throw if a required answer is missing or invalid. Default true. */
  strict?: boolean;
  /** Do/avoid guidance for custom (or redefined) tone words; the ones used are stored in the brief. */
  toneGuidance?: Record<string, ToneGuidance>;
}

const str = (v: AnswerValue | undefined): string | undefined => {
  if (v === undefined || typeof v === 'boolean') return undefined;
  const s = Array.isArray(v) ? v.join(', ') : String(v);
  return s.trim() || undefined;
};

const arr = (v: AnswerValue | undefined): string[] => {
  if (v === undefined || typeof v === 'boolean') return [];
  return Array.isArray(v) ? v : [String(v)];
};

/** Split "Headspace — the calm pacing" into the product and what to borrow from it. */
export function parseReference(ref: string): Reference {
  const m = /^(.+?)\s+[—–-]\s+(.+)$/.exec(ref) ?? /^([^:]+):\s+(.+)$/.exec(ref);
  return m ? { name: m[1]!.trim(), borrow: m[2]!.trim() } : { name: ref.trim() };
}

/** Build a typed brief from answers keyed by question id. */
export function buildBrief(input: Answers, opts: BuildOptions = {}): Brief {
  const questions = opts.questions ?? DEFAULT_QUESTIONS;
  const strict = opts.strict ?? true;

  const answers: Answers = {};
  for (const [id, value] of Object.entries(input)) answers[id] = value;
  for (const [id, value] of Object.entries(answers)) {
    const q = questions.find((x) => x.id === id);
    if (q) answers[id] = normalizeAnswer(q, value, answers);
  }

  if (strict) {
    const errors: string[] = [];
    for (const q of questions) {
      if (!isApplicable(q, answers)) continue;
      const result = validateAnswer(q, answers[q.id], answers);
      if (result !== true) errors.push(`${q.id}: ${result}`);
    }
    if (errors.length) throw new Error(`Invalid answers:\n  ${errors.join('\n  ')}`);
  }

  const labelFor = (id: string): string | undefined => {
    const v = str(answers[id]);
    if (!v) return undefined;
    return questions.find((q) => q.id === id)?.choices?.find((c) => c.value === v)?.label ?? v;
  };

  // Choice values become their labels, so the brief reads naturally.
  const readable = (q: Question, v: AnswerValue): AnswerValue => {
    const label = (x: string) => q.choices?.find((c) => c.value === x)?.label ?? x;
    if (q.type === 'scale' && typeof v === 'number') {
      const max = q.max ?? 5;
      const ends = q.minLabel && q.maxLabel ? ` (${q.min ?? 1} = ${q.minLabel}, ${max} = ${q.maxLabel})` : '';
      return `${v} of ${max}${ends}`;
    }
    if (Array.isArray(v)) return v.map(label);
    return typeof v === 'string' ? label(v) : v;
  };
  const field = (q: Question): ExtraField => ({
    section: q.section,
    id: q.id,
    label: q.prompt.replace(/\?$/, ''),
    value: readable(q, answers[q.id] as AnswerValue),
  });
  const answered = (q: Question) => !isEmpty(answers[q.id]) && isApplicable(q, answers);

  const extra = questions.filter((q) => !BUILT_IN_IDS.has(q.id) && answered(q)).map(field);
  const specifics = questions.filter((q) => BUILT_IN_IDS.has(q.id) && q.section === 'specifics' && answered(q)).map(field);

  const goals = arr(answers.goals);
  const priority = arr(answers.goalPriority).filter((g) => goals.includes(g));
  const ranked = goals.length > 1 && priority.length > 0;
  const successCriteria = ranked ? [...priority, ...goals.filter((g) => !priority.includes(g))] : goals;

  return {
    schemaVersion: 1,
    createdAt: (opts.now ?? new Date()).toISOString(),
    project: {
      name: str(answers.name) ?? 'Untitled project',
      summary: str(answers.summary) ?? '',
      kind: labelFor('kind'),
      fidelity: str(answers.fidelity),
    },
    users: {
      primary: str(answers.primaryUsers) ?? '',
      context: str(answers.userContext),
      secondary: arr(answers.secondaryUsers),
      accessibility: arr(answers.accessibility),
    },
    goals: {
      successCriteria,
      ...(ranked ? { ranked: true } : {}),
      primaryAction: str(answers.primaryAction),
      nonGoals: arr(answers.nonGoals),
    },
    constraints: {
      platforms: arr(answers.platforms),
      stack: str(answers.stack),
      content: str(answers.content),
      brandAssets: arr(answers.brandAssets),
      crossCutting: arr(answers.crossCutting),
      mustInclude: arr(answers.mustInclude),
      mustAvoid: arr(answers.mustAvoid),
    },
    tone: {
      traits: arr(answers.tone),
      ...toneGuidanceFor(arr(answers.tone), opts.toneGuidance),
      references: arr(answers.references),
      avoid: str(answers.antiTone),
    },
    specifics,
    extra,
  };
}

/** True if the value looks like a Brief rather than raw answers. */
export function isBrief(value: unknown): value is Brief {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Brief).schemaVersion === 1 &&
    typeof (value as Brief).project === 'object'
  );
}

function toneGuidanceFor(traits: string[], custom?: Record<string, ToneGuidance>): { guidance?: Record<string, ToneGuidance> } {
  if (!custom) return {};
  const used = Object.fromEntries(traits.filter((t) => custom[t]).map((t) => [t, custom[t]!]));
  return Object.keys(used).length ? { guidance: used } : {};
}
