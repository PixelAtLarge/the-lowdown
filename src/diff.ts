import type { AnswerValue, Brief } from './types.js';

export type BriefChange =
  | { field: string; label: string; kind: 'added' | 'removed' | 'changed'; before?: string; after?: string }
  | { field: string; label: string; kind: 'list'; added: string[]; removed: string[]; reordered: boolean };

type Getter = (b: Brief) => string | string[] | undefined;

const FIELDS: Array<[string, string, Getter]> = [
  ['project.name', 'Name', (b) => b.project.name],
  ['project.summary', 'Summary', (b) => b.project.summary],
  ['project.kind', 'Type', (b) => b.project.kind],
  ['project.fidelity', 'Fidelity', (b) => b.project.fidelity],
  ['users.primary', 'Primary user', (b) => b.users.primary],
  ['users.context', 'Their situation', (b) => b.users.context],
  ['users.secondary', 'Also used by', (b) => b.users.secondary],
  ['users.accessibility', 'Accessibility', (b) => b.users.accessibility],
  ['goals.successCriteria', 'Success looks like', (b) => b.goals.successCriteria],
  ['goals.primaryAction', 'Primary action', (b) => b.goals.primaryAction],
  ['goals.nonGoals', 'Out of scope', (b) => b.goals.nonGoals],
  ['constraints.platforms', 'Platforms', (b) => b.constraints.platforms],
  ['constraints.stack', 'Stack / design system', (b) => b.constraints.stack],
  ['constraints.content', 'Content', (b) => b.constraints.content],
  ['constraints.brandAssets', 'Brand assets', (b) => b.constraints.brandAssets],
  ['constraints.crossCutting', 'Applies everywhere', (b) => b.constraints.crossCutting],
  ['constraints.mustInclude', 'Must include', (b) => b.constraints.mustInclude],
  ['constraints.mustAvoid', 'Must avoid', (b) => b.constraints.mustAvoid],
  ['tone.traits', 'Tone', (b) => b.tone.traits],
  ['tone.references', 'References', (b) => b.tone.references],
  ['tone.avoid', 'Must never feel like', (b) => b.tone.avoid],
];

const show = (v: AnswerValue): string => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

function compare(field: string, label: string, a: string | string[] | undefined, b: string | string[] | undefined, out: BriefChange[]) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const before = (Array.isArray(a) ? a : a ? [a] : []);
    const after = (Array.isArray(b) ? b : b ? [b] : []);
    const added = after.filter((x) => !before.includes(x));
    const removed = before.filter((x) => !after.includes(x));
    const common = before.filter((x) => after.includes(x));
    const reordered = common.join('\u0000') !== after.filter((x) => before.includes(x)).join('\u0000');
    if (added.length || removed.length || reordered) out.push({ field, label, kind: 'list', added, removed, reordered });
    return;
  }
  const before = a?.trim() || undefined;
  const after = b?.trim() || undefined;
  if (before === after) return;
  out.push({ field, label, kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed', before, after });
}

/** What changed between two briefs, field by field. Empty when they say the same thing. */
export function diffBriefs(a: Brief, b: Brief): BriefChange[] {
  const out: BriefChange[] = [];
  for (const [field, label, get] of FIELDS) compare(field, label, get(a), get(b), out);
  if (Boolean(a.goals.ranked) !== Boolean(b.goals.ranked)) {
    out.push({ field: 'goals.ranked', label: 'Goals ranked', kind: 'changed', before: a.goals.ranked ? 'Yes' : 'No', after: b.goals.ranked ? 'Yes' : 'No' });
  }
  // Project specifics and custom questions, matched by their label.
  for (const key of ['specifics', 'extra'] as const) {
    const before = new Map((a[key] ?? []).map((f) => [f.label, f.value]));
    const after = new Map((b[key] ?? []).map((f) => [f.label, f.value]));
    for (const label of new Set([...before.keys(), ...after.keys()])) {
      const x = before.get(label);
      const y = after.get(label);
      const asList = (v: AnswerValue | undefined) => (Array.isArray(v) ? v : undefined);
      if (asList(x) || asList(y)) compare(`${key}.${label}`, label, asList(x) ?? (x === undefined ? undefined : [show(x)]), asList(y) ?? (y === undefined ? undefined : [show(y)]), out);
      else compare(`${key}.${label}`, label, x === undefined ? undefined : show(x), y === undefined ? undefined : show(y), out);
    }
  }
  return out;
}
