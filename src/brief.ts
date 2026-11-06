import { isEmpty, normalizeAnswer, validateAnswer } from './answers.js';
import { BUILT_IN_IDS, DEFAULT_QUESTIONS } from './questions.js';
import type { AnswerValue, Answers, Brief, ExtraField, Question } from './types.js';

export interface BuildOptions {
  questions?: Question[];
  now?: Date;
  /** Throw if a required answer is missing or invalid. Default true. */
  strict?: boolean;
}

const str = (v: AnswerValue | undefined): string | undefined => {
  if (v === undefined || typeof v === 'boolean') return undefined;
  const s = Array.isArray(v) ? v.join(', ') : v;
  return s.trim() || undefined;
};

const arr = (v: AnswerValue | undefined): string[] => {
  if (v === undefined || typeof v === 'boolean') return [];
  return Array.isArray(v) ? v : [v];
};

/** Build a typed brief from answers keyed by question id. */
export function buildBrief(input: Answers, opts: BuildOptions = {}): Brief {
  const questions = opts.questions ?? DEFAULT_QUESTIONS;
  const strict = opts.strict ?? true;

  const answers: Answers = {};
  for (const [id, value] of Object.entries(input)) {
    const q = questions.find((x) => x.id === id);
    answers[id] = q ? normalizeAnswer(q, value) : value;
  }

  if (strict) {
    const errors: string[] = [];
    for (const q of questions) {
      if (q.when && !q.when(answers)) continue;
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

  const extra: ExtraField[] = questions
    .filter((q) => !BUILT_IN_IDS.has(q.id) && !isEmpty(answers[q.id]))
    .map((q) => ({
      section: q.section,
      id: q.id,
      label: q.prompt.replace(/\?$/, ''),
      value: answers[q.id] as AnswerValue,
    }));

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
      accessibility: arr(answers.accessibility),
    },
    goals: {
      successCriteria: arr(answers.goals),
      primaryAction: str(answers.primaryAction),
      nonGoals: arr(answers.nonGoals),
    },
    constraints: {
      platforms: arr(answers.platforms),
      stack: str(answers.stack),
      mustInclude: arr(answers.mustInclude),
      mustAvoid: arr(answers.mustAvoid),
    },
    tone: {
      traits: arr(answers.tone),
      references: arr(answers.references),
      avoid: str(answers.antiTone),
    },
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
