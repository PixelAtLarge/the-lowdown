import { SECTIONS, TONE_GUIDANCE } from './questions.js';
import { parseReference } from './brief.js';
import { markdownToHtml } from './markdown.js';
import { titleCase } from './session.js';
import type { AnswerValue, Brief, OutputFormat, Section } from './types.js';

/** End with a full stop so guidance written without one still reads as a sentence. */
const sentence = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

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

export const CONTENT_GUIDANCE: Record<string, { label: string; guidance: string }> = {
  real: { label: 'Real content', guidance: 'Use the real content provided, word for word. Do not rewrite approved copy.' },
  some: {
    label: 'Some real content',
    guidance: 'Use real content where it is provided. Elsewhere write realistic placeholders and mark them as placeholders. Never lorem ipsum.',
  },
  none: {
    label: 'No content yet',
    guidance: 'Write realistic placeholder copy in the brief\'s tone. Never lorem ipsum, and never invent statistics, quotes or customer names.',
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
  /** Markdown only: start with a small YAML front matter block so tools can recognise the brief. Default false. */
  frontmatter?: boolean;
}

const fmtValue = (v: AnswerValue): string =>
  typeof v === 'boolean' ? (v ? 'Yes' : 'No') : Array.isArray(v) ? v.join(', ') : String(v);

/** Quote a YAML scalar only when it needs it. */
const yamlString = (s: string) => (/^[\w .,()/&+-]+$/.test(s) && !/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) ? s : JSON.stringify(s));

const fmtReference = (r: string, md: boolean) => {
  const { name, borrow } = parseReference(r);
  return borrow ? (md ? `**${name}:** borrow ${borrow}` : `${name}: borrow ${borrow}`) : name;
};

const specific = (b: Brief, id: string) => b.specifics?.find((x) => x.id === id)?.value;

const guidanceFor = (b: Brief, t: string) => b.tone.guidance?.[t] ?? b.tone.guidance?.[t.toLowerCase()] ?? TONE_GUIDANCE[t.toLowerCase()];
const toneLabelIn = (b: Brief) => (t: string) => guidanceFor(b, t)?.label ?? t;

function definitionOfDone(b: Brief): string[] {
  const items = [...b.goals.successCriteria];
  if (b.goals.primaryAction) items.push(`"${b.goals.primaryAction}" is the most prominent action on the main screen`);
  for (const a of b.users.accessibility) items.push(`Meets: ${a}`);
  for (const c of b.constraints.crossCutting ?? []) items.push(`Supports: ${c}`);
  if (specific(b, 'keyFlows')) items.push('Each key flow works end to end');
  if (specific(b, 'keyMetrics')) items.push('The key metrics are visible without scrolling');
  const goal = specific(b, 'conversionGoal');
  if (goal) items.push(`Every section leads toward: ${fmtValue(goal)}`);
  if (b.constraints.content === 'none' || b.constraints.content === 'some') items.push('No lorem ipsum, and no invented facts, quotes or names');
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

  if (opts.frontmatter) {
    line('---');
    line('brief: the-lowdown');
    line(`schema: ${b.schemaVersion}`);
    line(`project: ${yamlString(b.project.name)}`);
    line(`created: ${b.createdAt.slice(0, 10)}`);
    line('---');
    line();
  }
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
  block('Also used by (support them, but design for the primary user)', b.users.secondary ?? []);
  block('Accessibility (must)', b.users.accessibility);

  line('## Goals');
  line();
  if (b.goals.ranked) {
    line('**Success looks like** (in priority order; when two conflict, the higher one wins):');
    line();
    b.goals.successCriteria.forEach((g, i) => line(`${i + 1}. ${g}`));
    line();
  } else {
    block('Success looks like', b.goals.successCriteria);
  }
  if (b.goals.primaryAction) {
    line(`**Primary action:** ${b.goals.primaryAction}. Give it the strongest visual weight on the main screen.`);
    line();
  }
  block('Out of scope (do not build)', b.goals.nonGoals);
  extras('goals');

  if (b.specifics?.length) {
    line(`## Project specifics${b.project.kind ? ` (${b.project.kind})` : ''}`);
    line();
    for (const s of b.specifics) {
      if (Array.isArray(s.value) && s.value.length > 1) block(s.label, s.value);
      else field(s.label, fmtValue(s.value));
    }
    line();
  }

  line('## Constraints');
  line();
  const fid = b.project.fidelity ? FIDELITY_GUIDANCE[b.project.fidelity] : undefined;
  if (fid) field(`Fidelity (${fid.label})`, fid.guidance);
  else if (b.project.fidelity) field('Fidelity', b.project.fidelity);
  if (b.constraints.platforms.length) field('Platforms', b.constraints.platforms.join(', '));
  field('Stack / design system', b.constraints.stack);
  const content = b.constraints.content ? CONTENT_GUIDANCE[b.constraints.content] : undefined;
  if (content) field(`Content (${content.label})`, content.guidance);
  extras('constraints');
  line();
  block('Brand assets', b.constraints.brandAssets ?? []);
  block('Applies everywhere (must)', b.constraints.crossCutting ?? []);
  block('Must include', b.constraints.mustInclude);
  block('Must avoid', b.constraints.mustAvoid);

  if (b.tone.traits.length || b.tone.references.length || b.tone.avoid || extrasFor(b, 'tone').length) {
    line('## Tone');
    line();
    if (b.tone.traits.length) {
      line(`**Should feel:** ${b.tone.traits.map(toneLabelIn(b)).join(', ')}`);
      line();
      for (const t of b.tone.traits) {
        const g = guidanceFor(b, t);
        if (g) line(`- **${g.label}.** Do: ${sentence(g.do)} Avoid: ${sentence(g.avoid)}`);
      }
      if (b.tone.traits.some((t) => guidanceFor(b, t))) line();
    }
    block('References', b.tone.references.map((r) => fmtReference(r, true)));
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
    bullets('Also used by (support them, design for the primary user)', b.users.secondary ?? []),
    bullets('Accessibility (must)', b.users.accessibility),
    ...extras('users'),
  ]);
  tag('goals', [
    b.goals.ranked
      ? `Success looks like (priority order; higher wins a conflict):\n${b.goals.successCriteria.map((g, i) => `${i + 1}. ${g}`).join('\n')}`
      : bullets('Success looks like', b.goals.successCriteria),
    b.goals.primaryAction && `Primary action (strongest visual weight): ${b.goals.primaryAction}`,
    bullets('Out of scope (do not build)', b.goals.nonGoals),
    ...extras('goals'),
  ]);
  tag('project_specifics', (b.specifics ?? []).map((s) => `${s.label}: ${fmtValue(s.value)}`));
  tag('constraints', [
    b.constraints.platforms.length > 0 && `Platforms: ${b.constraints.platforms.join(', ')}`,
    b.constraints.stack && `Stack / design system: ${b.constraints.stack}`,
    b.constraints.content && CONTENT_GUIDANCE[b.constraints.content] && `Content: ${CONTENT_GUIDANCE[b.constraints.content]!.guidance}`,
    bullets('Brand assets', b.constraints.brandAssets ?? []),
    bullets('Applies everywhere (must)', b.constraints.crossCutting ?? []),
    bullets('Must include', b.constraints.mustInclude),
    bullets('Must avoid', b.constraints.mustAvoid),
    ...extras('constraints'),
  ]);
  tag('tone', [
    ...b.tone.traits.map((t) => {
      const g = guidanceFor(b, t);
      return g ? `${g.label}. Do: ${sentence(g.do)} Avoid: ${sentence(g.avoid)}` : t;
    }),
    b.tone.references.length > 0 && `References: ${b.tone.references.map((r) => fmtReference(r, false)).join('; ')}`,
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
    case 'html':
      return toHTML(b, opts);
  }
}

// ── HTML one-pager (print to PDF, open in Google Docs, paste into Notion) ──

const HTML_STYLE = `
:root { --ink:#22272B; --muted:#5A6268; --line:#CFD9DF; --accent:#1E4D36; --soft:#EFF8FF; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: var(--ink); font: 15px/1.55 Manrope, "Segoe UI", system-ui, -apple-system, sans-serif; }
main { max-width: 760px; margin: 40px auto; padding: 0 28px; }
h1 { font: 400 32px/1.15 "Young Serif", Georgia, "Times New Roman", serif; color: var(--accent); margin: 0 0 12px; }
h2 { font: 400 20px/1.2 "Young Serif", Georgia, serif; color: var(--accent); margin: 26px 0 8px; padding-top: 14px; border-top: 1px solid var(--line); }
p { margin: 0 0 8px; }
blockquote { margin: 0 0 12px; padding: 8px 14px; border-left: 4px solid var(--accent); background: var(--soft); color: var(--ink); font-size: 16px; }
ul, ol { margin: 4px 0 10px; padding-left: 22px; }
li { margin: 2px 0; }
li.task { list-style: none; margin-left: -22px; }
li.task::before { content: "\\2610"; margin-right: 8px; color: var(--muted); }
strong { font-weight: 700; }
code { font: 13px ui-monospace, Menlo, monospace; background: #F1F4F6; border-radius: 4px; padding: 1px 5px; }
footer { margin-top: 28px; color: var(--muted); font-size: 12px; }
@page { size: auto; margin: 14mm; }
@media print {
  body { font-size: 11pt; }
  main { margin: 0; max-width: none; padding: 0; }
  h1 { font-size: 22pt; }
  h2 { font-size: 13pt; margin-top: 14px; padding-top: 8px; break-after: avoid; }
  li, blockquote { break-inside: avoid; }
}`;

/** A standalone, print-friendly HTML page of the brief. */
export function toHTML(b: Brief, opts: RenderOptions = {}): string {
  const md = toMarkdown(b, { ...opts, frontmatter: false });
  const title = `Design brief: ${b.project.name}`.replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="the-lowdown">
<title>${title}</title>
<style>${HTML_STYLE}</style>
</head>
<body>
<main>
${markdownToHtml(md)}
<footer>Written with the-lowdown · ${b.createdAt.slice(0, 10)}</footer>
</main>
</body>
</html>
`;
}
