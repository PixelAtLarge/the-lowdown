import { TONE_TENSIONS } from './questions.js';
import { parseReference } from './brief.js';
import type { Brief, LintIssue } from './types.js';

const BROAD_USERS =
  /^(every(one|body)|anyone|all( of)?( the)?( users| people)?|users|people|the general public|general public|customers)\.?$/i;

const VAGUE =
  /\b(intuitive|user[- ]friendly|modern|clean|sleek|nice|beautiful|easy to use|seamless|engaging|delightful|best[- ]in[- ]class|world[- ]class)\b/i;

const MEASURABLE =
  /\d|%|\b(under|within|at least|at most|fewer|less than|more than|increase|reduce|decrease|without help|first try|no errors?)\b/i;

/**
 * Flag parts of a brief that tend to produce weak agent output: broad
 * audiences, adjective-only goals, missing scope limits, conflicting tone.
 * Advisory only; nothing here blocks rendering.
 */
export function lintBrief(brief: Brief): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (level: LintIssue['level'], field: string, message: string) =>
    issues.push({ level, field, message });

  const words = (s: string | undefined) => (s ?? '').trim().split(/\s+/).filter(Boolean).length;

  // Project
  if (words(brief.project.summary) < 6) {
    add('info', 'project.summary', 'The summary is very short. One more clause about who it is for or why helps the agent prioritise.');
  }

  // Users
  if (BROAD_USERS.test(brief.users.primary.trim())) {
    add('warn', 'users.primary', `"${brief.users.primary}" is too broad to design for. Name one kind of person and their situation.`);
  } else if (words(brief.users.primary) < 3) {
    add('info', 'users.primary', 'Add a detail about the primary user (context, device, experience level).');
  }

  // Goals
  for (const goal of brief.goals.successCriteria) {
    const m = goal.match(VAGUE);
    if (m) {
      add('warn', 'goals.successCriteria', `"${m[0]}" in "${goal}" is an adjective, not an outcome. What could a user do, or how fast?`);
    }
  }
  if (brief.goals.successCriteria.length && !brief.goals.successCriteria.some((g) => MEASURABLE.test(g))) {
    add('info', 'goals.successCriteria', 'None of the goals are measurable. Adding a number or threshold gives the agent something to check against.');
  }
  if (brief.goals.successCriteria.length > 2 && !brief.goals.ranked) {
    add('info', 'goals.successCriteria', 'Rank your goals so the agent knows which one wins when they conflict.');
  }
  if (!brief.goals.nonGoals.length) {
    add('info', 'goals.nonGoals', 'No out-of-scope items. Agents tend to over-build; listing even one or two helps.');
  }
  if (!brief.goals.primaryAction && !/content|component/i.test(brief.project.kind ?? '')) {
    add('info', 'goals.primaryAction', 'No primary action. Without one the agent may weigh every element equally.');
  }

  // Constraints
  if (brief.project.fidelity === 'production' && !brief.users.accessibility.length) {
    add('warn', 'users.accessibility', 'Production fidelity with no accessibility requirements. Consider at least WCAG 2.2 AA.');
  }
  const avoid = new Set(brief.constraints.mustAvoid.map((s) => s.toLowerCase()));
  for (const item of brief.constraints.mustInclude) {
    if (avoid.has(item.toLowerCase())) {
      add('warn', 'constraints', `"${item}" is listed as both must-include and must-avoid.`);
    }
  }

  // Project specifics
  const kind = (brief.project.kind ?? '').toLowerCase();
  const has = (id: string) => brief.specifics?.some((x) => x.id === id);
  if (kind.includes('marketing') && !has('conversionGoal')) {
    add('info', 'specifics.conversionGoal', 'A marketing page with no conversion goal tends to become a feature list. What should a visitor do?');
  }
  if (kind.includes('dashboard') && !has('keyMetrics')) {
    add('info', 'specifics.keyMetrics', 'Name the numbers that matter most, or every chart gets equal weight.');
  }

  // Tone
  const vague = brief.tone.references.map(parseReference).filter((r) => !r.borrow);
  if (vague.length) {
    add('info', 'tone.references', `Say what to borrow from ${vague.map((r) => r.name).join(', ')} (e.g. "${vague[0]!.name} — the pacing"), or the agent may copy it wholesale.`);
  }
  const traits = brief.tone.traits.map((t) => t.toLowerCase());
  if (!traits.length) {
    add('info', 'tone.traits', 'No tone words. The agent will fall back to generic defaults.');
  }
  if (traits.length > 3) {
    add('warn', 'tone.traits', `${traits.length} tone words dilute each other. Keep the three that matter most.`);
  }
  for (const [a, b] of TONE_TENSIONS) {
    if (traits.includes(a) && traits.includes(b)) {
      add('info', 'tone.traits', `"${a}" and "${b}" pull in opposite directions. Say which wins when they conflict.`);
    }
  }

  return issues;
}
