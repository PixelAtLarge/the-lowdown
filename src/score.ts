import { lintBrief } from './lint.js';
import { TONE_TENSIONS } from './questions.js';
import { parseReference } from './brief.js';
import type { Brief, LintIssue } from './types.js';

export interface ScorePart {
  label: string;
  points: number;
  max: number;
  /** What would earn the missing points. */
  tip?: string;
}

export interface BriefScore {
  /** 0–100. */
  score: number;
  grade: 'Thin' | 'Okay' | 'Strong' | 'Excellent';
  parts: ScorePart[];
  /** The two or three changes that would add the most points. */
  nextSteps: string[];
}

const MEASURABLE = /\d|%|\b(under|within|at least|at most|fewer|less than|more than|increase|reduce|decrease|without help|first try|no errors?)\b/i;
const BROAD = /^(every(one|body)|anyone|all|users|people|customers|the general public)\b/i;
const words = (s?: string) => (s ?? '').trim().split(/\s+/).filter(Boolean).length;

/**
 * How much an agent has to go on, from 0 to 100. Each part of the brief earns
 * points; warnings from the brief check take a few off.
 */
export function scoreBrief(b: Brief, issues: LintIssue[] = lintBrief(b)): BriefScore {
  const parts: ScorePart[] = [];
  const part = (label: string, points: number, max: number, tip?: string) =>
    parts.push({ label, points: Math.max(0, Math.min(max, points)), max, tip: points < max ? tip : undefined });

  const primary = b.users.primary.trim();
  part('Primary user', !primary ? 0 : BROAD.test(primary) ? 3 : words(primary) >= 4 ? 15 : 9, 15,
    'Describe the primary user in a few more words: who, where, on what device.');
  const measurable = b.goals.successCriteria.filter((g) => MEASURABLE.test(g)).length;
  part('Goals', (b.goals.successCriteria.length ? 6 : 0) + (measurable ? 7 : 0) + (b.goals.successCriteria.length < 2 || b.goals.ranked ? 2 : 0), 15,
    measurable ? 'Rank your goals so the agent knows which one wins.' : 'Make at least one goal measurable, with a number or a threshold.');
  part('Scope', b.goals.nonGoals.length ? 10 : 0, 10, 'List one or two things that are out of scope.');
  part('Primary action', b.goals.primaryAction ? 10 : 0, 10, 'Name the single most important action.');
  const traits = b.tone.traits.map((t) => t.toLowerCase());
  const tension = TONE_TENSIONS.some(([x, y]) => traits.includes(x) && traits.includes(y));
  part('Tone', !traits.length ? 0 : traits.length > 3 || tension ? 6 : 10, 10,
    traits.length ? 'Keep up to three tone words that don’t pull against each other.' : 'Pick up to three tone words.');
  part('Fidelity', b.project.fidelity ? 10 : 0, 10, 'Say how finished it should be: sketch, prototype or production.');
  part('Constraints', (b.constraints.stack ? 6 : 0) + (b.constraints.platforms.length ? 4 : 0), 10,
    'Add the stack or design system and the platforms it must run on.');
  part('Accessibility', b.users.accessibility.length ? 10 : 0, 10, 'Set an accessibility bar, e.g. WCAG 2.2 AA.');
  part('Context', (b.users.context ? 3 : 0) + (b.constraints.content ? 2 : 0), 5,
    'Describe the user’s situation and whether real content exists.');
  const refs = b.tone.references.map(parseReference);
  part('Specifics', (b.specifics?.length ? 3 : 0) + (refs.length && refs.every((r) => r.borrow) ? 2 : refs.length ? 1 : 0) + (!refs.length && b.specifics?.length ? 2 : 0), 5,
    'Answer the questions for your kind of project, and say what to borrow from each reference.');

  const warnings = issues.filter((i) => i.level === 'warn').length;
  const raw = parts.reduce((n, p) => n + p.points, 0) - warnings * 4;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const grade = score >= 85 ? 'Excellent' : score >= 70 ? 'Strong' : score >= 45 ? 'Okay' : 'Thin';
  const nextSteps = [
    ...issues.filter((i) => i.level === 'warn').map((i) => i.message),
    ...[...parts].sort((x, y) => (y.max - y.points) - (x.max - x.points)).filter((p) => p.tip).map((p) => p.tip!),
  ].slice(0, 3);
  return { score, grade, parts, nextSteps };
}

/** The tips that would add the most points, largest gap first. Unlike `nextSteps`, these never repeat lint messages. */
export function scoreTips(s: BriefScore, n = 2): string[] {
  return s.parts.filter((p) => p.tip).sort((a, b) => (b.max - b.points) - (a.max - a.points)).slice(0, n).map((p) => p.tip!);
}
