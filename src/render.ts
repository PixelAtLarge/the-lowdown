import { SECTIONS, TONE_GUIDANCE } from './questions.js';
import { titleCase } from './session.js';
import type { AnswerValue, Brief, OutputFormat, Section } from './types.js';

export const FIDELITY_GUIDANCE: Record<string, { label: string; guidance: string }> = {
  sketch: {
    label: 'Sketch',
    guidance:
      'Optimise for speed and range of ideas. Rough visuals and placeholder content are fine. Skip edge cases, tests and polish.',
  },
  prototype: {
    label: 'Prototype',
    guidance:
      'Realistic content and the main happy path working end to end, including key empty and loading states. Do not harden: no exhaustive error handling or tests unless asked.',
  },
  production: {
    label: 'Production',
    guidance:
      'Ship quality: every state (empty, loading, error, success), responsive, accessible, tested, and following the stack’s existing conventions.',
  },
};

export const AGENT_INSTRUCTIONS =
  'You are working from this brief. Treat "Must" items as hard requirements and "Out of scope" as do-not-build. ' +
  'When the brief is silent, choose whatever best serves the primary user and the primary action, ' +
  'and list the assumptions you made at the end of your response. ' +
  'If two requirements conflict, stop and ask rather than guessing.';

export interface RenderOptions {
  /** Section titles for custom questions. */
  sections?: Section[];
  /** Include the "how to use this brief" agent instructions. Default true. */
  instructions?: boolean;
  /** Include the definition-of-done checklist. Default true. */
  checklist?: boolean;
}

const fmtValue = (v: AnswerValue): string =>
  typeof v === 'boolean' ? (v ? 'Yes' : 'No') : Array.isArray(v) ? v.join(', ') : v;

const toneLabel = (t: string) => TONE_GUIDANCE[t.toLowerCase()]?.label ?? t;

function definitionOfDone(b: Brief): string[] {
  const items = [...b.goals.successCriteria];
  if (b.goals.primaryAction) items.push(`"${b.goals.primaryAction}" is the most prominent action on the main screen`);
  for (const a of b.users.accessibility) items.push(`Meets: ${a}`);
  if (b.constraints.platforms.length) items.push(`Works on ${b.constraints.platforms.join(', ')}`);
  for (const m of b.constraints.mustInclude) items.push(`Includes: ${m}`);
  if (b.constraints.mustAvoid.length) items.push('Nothing on the must-avoid list appears');
  if (b.goals.nonGoals.length) items.push('Nothing out of scope was built');
  items.push('Assumptions are listed');
  return items;
}

function extrasFor(b: Brief, section: string): Array<[string, string]> {
  return b.extra.filter((e) => e.section === section).map((e) => [e.label, fmtValue(e.value)]);
}

// ── Markdown ─────────────────────────────────────────────────

export function toMarkdown(b: Brief, opts: RenderOptions = {}): string {
  const out: string[] = [];
  const line = (s = '') => out.push(s);
  const list = (items: string[]) => items.forEach((i) => line(`- ${i}`));
  const field = (label: string, value?: string) => value && line(`**${label}:** ${value}  `);
  const block = (label: string, items: string[]) => {
    if (!items.length) return;
    line(`**${label}:**`);
    line();
    list(items);
    line();
  };
  const extras = (section: string) => {
    for (const [label, value] of extrasFor(b, section)) field(label, value);
  };

  line(`# Design brief: ${b.project.name}`);
  line();
  if (b.project.summary) {
    line(`> ${b.project.summary}`);
    line();
  }
  const meta = [
    b.project.kind && `**Type:** ${b.project.kind}`,
    b.project.fidelity && `**Fidelity:** ${FIDELITY_GUIDANCE[b.project.fidelity]?.label ?? b.project.fidelity}`,
  ].filter(Boolean);
  if (meta.length) {
    line(meta.join(' · '));
    line();
  }
  extras('project');
  if (b.extra.some((e) => e.section === 'project')) line();

  if (opts.instructions ?? true) {
    line('## How to use this brief');
    line();
    line(AGENT_INSTRUCTIONS);
    line();
  }

  line('## Users');
  line();
  field('Primary user', b.users.primary);
  field('Their situation', b.users.context);
  extras('users');
  line();
  block('Accessibility (must)', b.users.accessibility);

  line('## Goals');
  line();
  block('Success looks like', b.goals.successCriteria);
  if (b.goals.primaryAction) {
    line(`**Primary action:** ${b.goals.primaryAction}. Give it the strongest visual weight on the main screen.`);
    line();
  }
  block('Out of scope (do not build)', b.goals.nonGoals);
  extras('goals');

  line('## Constraints');
  line();
  const fid = b.project.fidelity ? FIDELITY_GUIDANCE[b.project.fidelity] : undefined;
  if (fid) field(`Fidelity (${fid.label})`, fid.guidance);
  else if (b.project.fidelity) field('Fidelity', b.project.fidelity);
  if (b.constraints.platforms.length) field('Platforms', b.constraints.platforms.join(', '));
  field('Stack / design system', b.constraints.stack);
  extras('constraints');
  line();
  block('Must include', b.constraints.mustInclude);
  block('Must avoid', b.constraints.mustAvoid);

  if (b.tone.traits.length || b.tone.references.length || b.tone.avoid || extrasFor(b, 'tone').length) {
    line('## Tone');
    line();
    if (b.tone.traits.length) {
      line(`**Should feel:** ${b.tone.traits.map(toneLabel).join(', ')}`);
      line();
      for (const t of b.tone.traits) {
        const g = TONE_GUIDANCE[t.toLowerCase()];
        if (g) line(`- **${g.label}.** Do: ${g.do} Avoid: ${g.avoid}`);
      }
      if (b.tone.traits.some((t) => TONE_GUIDANCE[t.toLowerCase()])) line();
    }
    block('References', b.tone.references);
    field('Must never feel like', b.tone.avoid);
    extras('tone');
    if (b.tone.avoid || extrasFor(b, 'tone').length) line();
  }

  const known = new Set(SECTIONS.map((s) => s.id));
  const custom = [...new Set(b.extra.map((e) => e.section))].filter((s) => !known.has(s));
  for (const id of custom) {
    const title = opts.sections?.find((s) => s.id === id)?.title ?? titleCase(id);
    line(`## ${title}`);
    line();
    extras(id);
    line();
  }

  if (opts.checklist ?? true) {
    line('## Definition of done');
    line();
    definitionOfDone(b).forEach((i) => line(`- [ ] ${i}`));
    line();
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ── Prompt (XML-tagged, compact) ─────────────────────────────

export function toPrompt(b: Brief, opts: RenderOptions = {}): string {
  const out: string[] = [];
  const tag = (name: string, lines: Array<string | undefined | false>) => {
    const body = lines.filter((l): l is string => Boolean(l));
    if (!body.length) return;
    out.push(`<${name}>`, ...body, `</${name}>`);
  };
  const bullets = (label: string, items: string[]) =>
    items.length ? `${label}:\n${items.map((i) => `- ${i}`).join('\n')}` : undefined;
  const extras = (s: string) => extrasFor(b, s).map(([l, v]) => `${l}: ${v}`);

  out.push(`<design_brief project="${b.project.name.replace(/"/g, "'")}">`);
  if (opts.instructions ?? true) tag('instructions', [AGENT_INSTRUCTIONS]);
  tag('project', [
    b.project.summary,
    b.project.kind && `Type: ${b.project.kind}`,
    b.project.fidelity &&
      `Fidelity: ${FIDELITY_GUIDANCE[b.project.fidelity]?.label ?? b.project.fidelity}. ${FIDELITY_GUIDANCE[b.project.fidelity]?.guidance ?? ''}`.trim(),
    ...extras('project'),
  ]);
  tag('users', [
    `Primary user: ${b.users.primary}`,
    b.users.context && `Situation: ${b.users.context}`,
    bullets('Accessibility (must)', b.users.accessibility),
    ...extras('users'),
  ]);
  tag('goals', [
    bullets('Success looks like', b.goals.successCriteria),
    b.goals.primaryAction && `Primary action (strongest visual weight): ${b.goals.primaryAction}`,
    bullets('Out of scope (do not build)', b.goals.nonGoals),
    ...extras('goals'),
  ]);
  tag('constraints', [
    b.constraints.platforms.length > 0 && `Platforms: ${b.constraints.platforms.join(', ')}`,
    b.constraints.stack && `Stack / design system: ${b.constraints.stack}`,
    bullets('Must include', b.constraints.mustInclude),
    bullets('Must avoid', b.constraints.mustAvoid),
    ...extras('constraints'),
  ]);
  tag('tone', [
    ...b.tone.traits.map((t) => {
      const g = TONE_GUIDANCE[t.toLowerCase()];
      return g ? `${g.label}. Do: ${g.do} Avoid: ${g.avoid}` : t;
    }),
    b.tone.references.length > 0 && `References: ${b.tone.references.join('; ')}`,
    b.tone.avoid && `Must never feel like: ${b.tone.avoid}`,
    ...extras('tone'),
  ]);
  const known = new Set(SECTIONS.map((s) => s.id));
  for (const id of new Set(b.extra.map((e) => e.section))) {
    if (!known.has(id)) tag(id.replace(/[^\w-]/g, '_'), extras(id));
  }
  if (opts.checklist ?? true) tag('definition_of_done', definitionOfDone(b).map((i) => `- ${i}`));
  out.push('</design_brief>');
  return out.join('\n') + '\n';
}

export function toJSON(b: Brief): string {
  return JSON.stringify(b, null, 2) + '\n';
}

export function renderBrief(b: Brief, format: OutputFormat = 'markdown', opts: RenderOptions = {}): string {
  switch (format) {
    case 'markdown':
      return toMarkdown(b, opts);
    case 'prompt':
      return toPrompt(b, opts);
    case 'json':
      return toJSON(b);
  }
}
