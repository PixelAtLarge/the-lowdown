import type { AnswerValue, Answers, Choice, Question } from './types.js';

export function isEmpty(value: AnswerValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === 'boolean') return false;
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

/**
 * Coerce a loosely-typed value (e.g. from JSON, a form, or a chat agent)
 * into the canonical shape for the question type. Choice labels are mapped
 * to their values. Does not validate.
 */
export function normalizeAnswer(q: Question, value: AnswerValue): AnswerValue {
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
  }
}

/**
 * Parse free text typed by a person (CLI) or produced by an agent running the
 * interview in chat. Accepts choice numbers ("2", "1,3"), labels, or values.
 */
export function parseInput(q: Question, raw: string): AnswerValue {
  const text = raw.trim();
  if (q.type === 'select' && /^\d+$/.test(text)) {
    const c = q.choices?.[Number(text) - 1];
    if (c) return c.value;
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
  return normalizeAnswer(q, text);
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
  return q.validate ? q.validate(v, answers) : true;
}
