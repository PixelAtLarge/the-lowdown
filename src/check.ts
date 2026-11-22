import { TONE_GUIDANCE } from './questions.js';
import { definitionOfDone } from './render.js';
import type { Brief } from './types.js';

export type CheckGroup = 'Definition of done' | 'Must avoid' | 'Out of scope' | 'Tone';

/** One thing to verify in the finished work. */
export interface CheckItem {
  id: string;
  group: CheckGroup;
  text: string;
}

/** An accessibility or usability finding from another tool (e.g. curb-cut), to fold into the review. */
export interface Finding {
  severity: string;
  title: string;
  page?: string;
  fix?: string;
}

export interface CheckOptions {
  /** Files that changed, for context. */
  changedFiles?: string[];
  /** Findings from an automated review of the running preview. */
  findings?: Finding[];
  /** Where the findings came from, e.g. "curb-cut on https://preview.example.com". */
  findingsSource?: string;
  /** The brief's file name, for the instructions. Default BRIEF.md. */
  briefPath?: string;
}

/**
 * Everything the finished work should be checked against: the definition of
 * done, the must-avoid and out-of-scope lists, and the tone's "avoid" notes.
 */
export function checklist(b: Brief): CheckItem[] {
  const items: CheckItem[] = [];
  const add = (group: CheckGroup, text: string) => items.push({ id: `c${items.length + 1}`, group, text });
  for (const d of definitionOfDone(b)) {
    if (d === 'Nothing on the must-avoid list appears' || d === 'Nothing out of scope was built') continue; // itemised below
    add('Definition of done', d);
  }
  for (const m of b.constraints.mustAvoid) add('Must avoid', `Not present: ${m}`);
  for (const n of b.goals.nonGoals) add('Out of scope', `Not built: ${n}`);
  for (const t of b.tone.traits) {
    const g = b.tone.guidance?.[t] ?? b.tone.guidance?.[t.toLowerCase()] ?? TONE_GUIDANCE[t.toLowerCase()];
    if (g) add('Tone', `${g.label}: none of ${g.avoid.replace(/\.$/, '').toLowerCase()}`);
  }
  return items;
}

/**
 * A self-review prompt for the agent that did the work: check each item,
 * mark it pass, fail or unsure with evidence, fix the fails, run again.
 */
export function checkPrompt(b: Brief, opts: CheckOptions = {}): string {
  const items = checklist(b);
  const brief = opts.briefPath ?? 'BRIEF.md';
  const out: string[] = [];
  out.push(`# Check the work against ${brief}: ${b.project.name}`);
  out.push('');
  out.push(
    `Review what you built against the brief before calling it done. For each item, answer **pass**, **fail** or **unsure**, with evidence: a file and line, or what you saw in the running app. ` +
      `Don't mark something pass because you meant to do it. Fix every fail, re-check, then report the final list, and list your assumptions.`,
  );
  out.push('');
  out.push(`**Primary user:** ${b.users.primary}`);
  if (b.goals.primaryAction) out.push(`**Primary action:** ${b.goals.primaryAction}`);
  if (b.project.fidelity) out.push(`**Fidelity:** ${b.project.fidelity[0]!.toUpperCase()}${b.project.fidelity.slice(1)}`);
  let group = '';
  for (const i of items) {
    if (i.group !== group) {
      group = i.group;
      out.push('');
      out.push(`## ${group}`);
      out.push('');
    }
    out.push(`- [ ] ${i.id}. ${i.text}`);
  }
  if (opts.findings) {
    out.push('');
    out.push(`## Automated review${opts.findingsSource ? ` (${opts.findingsSource})` : ''}`);
    out.push('');
    if (!opts.findings.length) out.push('No issues found. Automated checks catch only part of what matters, so keep the items above in mind.');
    for (const f of opts.findings) out.push(`- **${f.severity}:** ${f.title}${f.page ? ` (${f.page})` : ''}${f.fix ? `. Fix: ${f.fix}` : ''}`);
  }
  if (opts.changedFiles?.length) {
    out.push('');
    out.push('## Changed files');
    out.push('');
    for (const f of opts.changedFiles.slice(0, 60)) out.push(`- ${f}`);
    if (opts.changedFiles.length > 60) out.push(`- …and ${opts.changedFiles.length - 60} more`);
  }
  out.push('');
  out.push('## Report');
  out.push('');
  out.push('Reply with one line per item: `c1 pass: <evidence>`, `c2 fail: <what is wrong>, fixed in <file>`, or `c3 unsure: <what you could not verify>`.');
  return out.join('\n') + '\n';
}
