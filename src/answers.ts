import type { AnswerValue, Answers, Choice, Condition, Question } from './types.js';

export function isEmpty(value: AnswerValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === 'boolean' || typeof value === 'number') return false;
  if (Array.isArray(value)) return value.length === 0;
  return value.trim() === '';
}

function matchChoice(choices: Choice[] | undefined, raw: string): string | undefined {
  const needle = raw.trim().toLowerCase();
  const hit = choices?.find(
    (c) => c.value.toLowerCase() === needle || c.label.toLowerCase() === needle,
  );
  return hit?.value;
}

function splitList(raw: string): string[] {
  return raw
    .split(/\r?\n|;/)
    .map((s) => s.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

const asStrings = (v: AnswerValue | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : typeof v === 'string' ? splitList(v) : [String(v)];

/** The items a rank question orders: another answer's list, or its fixed choices. */
export function rankItems(q: Question, answers: Answers = {}): string[] {
  if (q.rankFrom) return dedupe(asStrings(answers[q.rankFrom]));
  return q.choices?.map((c) => c.value) ?? [];
}

/** The range of a scale question. */
export function scaleRange(q: Question): { min: number; max: number } {
  return { min: q.min ?? 1, max: q.max ?? 5 };
}

/** True when every key in the condition matches the answers. */
export function matchesCondition(condition: Condition | undefined, answers: Answers): boolean {
  if (!condition) return true;
  return Object.entries(condition).every(([id, want]) => {
    const have = answers[id];
    if (want === '*') return !isEmpty(have);
    const wanted = Array.isArray(want) ? want : [want];
    const has = Array.isArray(have) ? have : have === undefined ? [] : [have];
    return wanted.some((w) => has.some((h) => String(h).toLowerCase() === String(w).toLowerCase()));
  });
}

/** True when a question applies, given its `when` function and `condition`. */
export function isApplicable(q: Question, answers: Answers): boolean {
  return matchesCondition(q.condition, answers) && (q.when ? q.when(answers) : true);
}

/**
 * Coerce a loosely-typed value (e.g. from JSON, a form, or a chat agent)
 * into the canonical shape for the question type. Choice labels are mapped
 * to their values. Does not validate.
 */
export function normalizeAnswer(q: Question, value: AnswerValue, answers: Answers = {}): AnswerValue {
  switch (q.type) {
    case 'text':
    case 'longtext':
      if (Array.isArray(value)) return value.join(', ').trim();
      return String(value).trim();
    case 'list': {
      const items = Array.isArray(value) ? value : splitList(String(value));
      return dedupe(items.map((s) => String(s).trim()).filter(Boolean));
    }
    case 'select': {
      const raw = Array.isArray(value) ? (value[0] ?? '') : String(value);
      return matchChoice(q.choices, raw) ?? raw.trim();
    }
    case 'multiselect': {
      const items = Array.isArray(value) ? value : String(value).split(',');
      return dedupe(
        items
          .map((s) => String(s).trim())
          .filter(Boolean)
          .map((s) => matchChoice(q.choices, s) ?? s),
      );
    }
    case 'confirm':
      if (typeof value === 'boolean') return value;
      return /^(y|yes|true|1)$/i.test(String(value).trim());
    case 'scale': {
      if (typeof value === 'number') return value;
      const raw = Array.isArray(value) ? value[0] : value;
      const n = Number(String(raw).trim());
      return String(raw).trim() === '' || Number.isNaN(n) ? String(raw).trim() : n;
    }
    case 'rank': {
      const items = rankItems(q, answers);
      const given = (Array.isArray(value) ? value : String(value).split(','))
        .map((s) => String(s).trim())
        .filter(Boolean)
        .map((s) => matchChoice(q.choices, s) ?? items.find((i) => i.toLowerCase() === s.toLowerCase()) ?? s);
      const ordered = dedupe(given);
      // Anything left unranked keeps its original order at the end.
      return [...ordered, ...items.filter((i) => !ordered.includes(i))];
    }
  }
}

/**
 * Parse free text typed by a person (CLI) or produced by an agent running the
 * interview in chat. Accepts choice numbers ("2", "1,3"), labels, or values.
 */
export function parseInput(q: Question, raw: string, answers: Answers = {}): AnswerValue {
  const text = raw.trim();
  if (q.type === 'select' && /^\d+$/.test(text)) {
    const c = q.choices?.[Number(text) - 1];
    if (c) return c.value;
  }
  if (q.type === 'rank') {
    const items = rankItems(q, answers);
    const parts = text.split(/[,\s]+/).filter(Boolean);
    if (parts.length && parts.every((p) => /^\d+$/.test(p))) {
      return normalizeAnswer(q, parts.map((p) => items[Number(p) - 1] ?? p), answers);
    }
    return normalizeAnswer(q, text.split(','), answers);
  }
  if (q.type === 'multiselect') {
    const parts = text.split(/[,\s]+/).filter(Boolean);
    const allNumbers = parts.length > 0 && parts.every((p) => /^\d+$/.test(p));
    if (allNumbers) {
      return normalizeAnswer(
        q,
        parts.map((p) => q.choices?.[Number(p) - 1]?.value ?? p),
      );
    }
    // Mixed: "1, 3, Brutalist" -> numbers map to choices, text kept.
    return normalizeAnswer(
      q,
      text.split(',').map((p) => {
        const t = p.trim();
        return /^\d+$/.test(t) ? (q.choices?.[Number(t) - 1]?.value ?? t) : t;
      }),
    );
  }
  if (q.type === 'confirm') {
    if (/^(n|no|false|0)$/i.test(text)) return false;
    if (/^(y|yes|true|1)$/i.test(text)) return true;
  }
  return normalizeAnswer(q, text, answers);
}

/** Returns an error message, or `true` if the answer is acceptable. */
export function validateAnswer(
  q: Question,
  value: AnswerValue | undefined,
  answers: Answers = {},
): string | true {
  if (isEmpty(value)) {
    return q.required ? 'This one is required.' : true;
  }
  const v = value as AnswerValue;
  const known = new Set(q.choices?.map((c) => c.value));

  if (q.type === 'select' && q.choices && !q.allowOther && !known.has(String(v))) {
    return `Choose one of: ${q.choices.map((c) => c.label).join(', ')}.`;
  }
  if (q.type === 'multiselect') {
    const picks = Array.isArray(v) ? v : [String(v)];
    if (q.choices && !q.allowOther) {
      const bad = picks.filter((p) => !known.has(p));
      if (bad.length) return `Not an option: ${bad.join(', ')}.`;
    }
    if (q.max && picks.length > q.max) {
      return `Pick at most ${q.max}. Fewer, sharper words give the agent clearer direction.`;
    }
  }
  if (q.type === 'scale') {
    const { min, max } = scaleRange(q);
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      return `Pick a whole number from ${min} to ${max}.`;
    }
  }
  if (q.type === 'rank') {
    const items = rankItems(q, answers);
    const order = Array.isArray(v) ? v : [String(v)];
    const bad = order.filter((o) => !items.includes(o));
    if (bad.length) return `Not one of the items to rank: ${bad.join(', ')}.`;
  }
  return q.validate ? q.validate(v, answers) : true;
}
