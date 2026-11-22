import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  BriefSession,
  DEFAULT_QUESTIONS,
  buildBrief,
  createBrief,
  isBrief,
  lintBrief,
  parseInput,
  BudgetError,
  createAssistant,
  diffBriefs,
  draftFromText,
  followUpFor,
  htmlToText,
  isMarkdownBrief,
  questionForField,
  type Complete,
  markdownToHtml,
  parseMarkdownBrief,
  questionsToJSON,
  readBrief,
  renderBrief,
  scoreBrief,
  scoreTips,
  stripFrontmatter,
  toHTML,
  toMarkdown,
  type Answers,
  type Question,
} from './index.js';
import { linkBrief, linkInstruction } from './link.js';
import { anthropicApi, claudeCode, readSource } from './ai.js';
import { answersFromHash, decodeAnswers, encodeAnswers, shareUrl } from './share.js';

const NOW = new Date('2026-11-05T12:00:00Z');

const answers: Answers = {
  name: 'HealthHub onboarding',
  summary: 'A three-step onboarding flow that gets new members to book a first session.',
  kind: 'Web app / product UI', // label, should map to value
  fidelity: 'prototype',
  primaryUsers: 'Busy parents booking care on their phone',
  goals: ['Book a session in under 60 seconds'],
  primaryAction: 'Book a session',
  nonGoals: 'Payments; Account settings',
  tone: ['Calm', 'warm'],
};

const q = (id: string) => DEFAULT_QUESTIONS.find((x) => x.id === id)!;

describe('parseInput', () => {
  it('maps choice numbers, labels and values', () => {
    assert.equal(parseInput(q('fidelity'), '3'), 'production');
    assert.equal(parseInput(q('fidelity'), 'Sketch'), 'sketch');
    assert.deepEqual(parseInput(q('tone'), '1, 3'), ['calm', 'playful']);
    assert.deepEqual(parseInput(q('tone'), '1, Brutalist'), ['calm', 'Brutalist']);
  });
  it('splits lists on newlines and semicolons and strips bullets', () => {
    assert.deepEqual(parseInput(q('goals'), '- one\n* two; three'), ['one', 'two', 'three']);
  });
});

describe('BriefSession', () => {
  it('walks required questions and refuses to skip them', () => {
    const s = new BriefSession({ quick: true });
    assert.equal(s.current()?.id, 'name');
    assert.deepEqual(s.skip(), { ok: false, error: 'This one is required.' });
    assert.ok(s.answer('Demo').ok);
    assert.equal(s.current()?.id, 'summary');
  });

  it('supports back with the previous answer kept as a draft', () => {
    const s = new BriefSession();
    s.answer('First name');
    s.back();
    assert.equal(s.current()?.id, 'name');
    assert.equal(s.draft('name'), 'First name');
  });

  it('applies defaults on skip', () => {
    const s = new BriefSession({ answers: { name: 'x', summary: 'y', kind: 'web-app', fidelity: 'sketch', keyFlows: ['Book'], primaryUsers: 'z', userContext: 'c', secondaryUsers: ['Staff'] } });
    assert.equal(s.current()?.id, 'accessibility');
    s.skip();
    assert.deepEqual(s.answers.accessibility, ['WCAG 2.2 AA']);
  });

  it('enforces multiselect max and select choices', () => {
    const s = new BriefSession({ questions: [q('tone'), q('fidelity')] });
    assert.equal(s.answerText('1,2,3,4').ok, false);
    assert.ok(s.answerText('1,2').ok);
    assert.equal(s.answer('glossy').ok, false);
  });

  it('quick mode asks fewer questions', () => {
    const full = new BriefSession().applicable().length;
    const quick = new BriefSession({ quick: true }).applicable().length;
    assert.ok(quick < full, `${quick} < ${full}`);
  });

  it('honours `when` on custom questions', () => {
    const questions: Question[] = [
      { id: 'hasBrand', section: 'brand', type: 'confirm', prompt: 'Existing brand?' },
      { id: 'brandUrl', section: 'brand', type: 'text', prompt: 'Brand guidelines URL', when: (a) => a.hasBrand === true },
    ];
    const no = new BriefSession({ questions });
    no.answerText('n');
    assert.equal(no.isComplete, true);
    const yes = new BriefSession({ questions });
    yes.answerText('y');
    assert.equal(yes.current()?.id, 'brandUrl');
  });

  it('throws from toBrief when required answers are missing', () => {
    assert.throws(() => new BriefSession().toBrief(), /Missing required/);
  });
});

describe('buildBrief', () => {
  it('normalizes answers into the brief shape', () => {
    const b = buildBrief(answers, { now: NOW });
    assert.equal(b.project.kind, 'Web app / product UI');
    assert.deepEqual(b.tone.traits, ['calm', 'warm']);
    assert.deepEqual(b.goals.nonGoals, ['Payments', 'Account settings']);
    assert.equal(b.createdAt, NOW.toISOString());
    assert.ok(isBrief(b));
    assert.equal(isBrief(answers), false);
  });

  it('rejects invalid answers in strict mode', () => {
    assert.throws(() => buildBrief({ name: 'x' }), /summary: This one is required/);
    assert.doesNotThrow(() => buildBrief({ name: 'x' }, { strict: false }));
  });

  it('puts custom questions in extra and renders them under their section', () => {
    const questions: Question[] = [
      ...DEFAULT_QUESTIONS,
      { id: 'competitors', section: 'goals', type: 'list', prompt: 'Main competitors?' },
      { id: 'owner', section: 'stakeholders', type: 'text', prompt: 'Who signs off?' },
    ];
    const b = buildBrief({ ...answers, competitors: 'Calm; Headspace', owner: 'Anna' }, { questions, now: NOW });
    assert.equal(b.extra.length, 2);
    const md = renderBrief(b, 'markdown');
    assert.match(md, /\*\*Main competitors:\*\* Calm, Headspace/);
    assert.match(md, /## Stakeholders\n\n\*\*Who signs off:\*\* Anna/);
    assert.match(renderBrief(b, 'prompt'), /<stakeholders>\nWho signs off: Anna\n<\/stakeholders>/);
  });
});

describe('renderers', () => {
  const b = buildBrief(answers, { now: NOW });

  it('markdown includes tone guidance, fidelity and a checklist', () => {
    const md = renderBrief(b);
    assert.match(md, /^# Design brief: HealthHub onboarding/);
    assert.match(md, /\*\*Calm\.\*\* Do: Generous whitespace/);
    assert.match(md, /Fidelity \(Prototype\)/);
    assert.match(md, /- \[ \] "Book a session" is the most prominent action/);
    assert.doesNotMatch(md, /\n{3,}/);
  });

  it('can omit instructions and checklist', () => {
    const md = createBrief(answers, { instructions: false, checklist: false });
    assert.doesNotMatch(md, /How to use this brief|Definition of done/);
  });

  it('json round-trips', () => {
    assert.deepEqual(JSON.parse(renderBrief(b, "json")), JSON.parse(JSON.stringify(b)));
  });

  it('prompt output is tag-wrapped', () => {
    const p = renderBrief(b, 'prompt');
    assert.match(p, /^<design_brief project="HealthHub onboarding">/);
    assert.match(p, /<\/design_brief>\n$/);
  });
});

describe('lintBrief', () => {
  it('flags broad users, vague goals, missing scope and tone tension', () => {
    const b = buildBrief(
      { ...answers, primaryUsers: 'Everyone', goals: ['Clean and modern'], nonGoals: [], tone: ['calm', 'bold'] },
      { now: NOW },
    );
    const fields = lintBrief(b).map((i) => `${i.level}:${i.field}`);
    assert.ok(fields.includes('warn:users.primary'));
    assert.ok(fields.includes('warn:goals.successCriteria'));
    assert.ok(fields.includes('info:goals.nonGoals'));
    assert.ok(fields.includes('info:tone.traits'));
  });

  it('is quiet on a solid brief', () => {
    const issues = lintBrief(buildBrief(answers, { now: NOW }));
    assert.deepEqual(issues.filter((i) => i.level === 'warn'), []);
  });
});

describe('questionsToJSON', () => {
  it('strips functions and marks quick questions', () => {
    const json = questionsToJSON();
    assert.ok(json.instructions.length > 50);
    assert.equal(json.questions.length, DEFAULT_QUESTIONS.length);
    assert.ok(json.questions.every((x) => typeof (x as unknown as Question).when !== 'function'));
    assert.equal(json.questions.find((x) => x.id === 'name')?.quick, true);
  });
});

describe('cli', () => {
  const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'the-lowdown-'));

  it('runs the quick interview from piped input', () => {
    const input = [
      'Demo', // name
      'A small tool that helps teams write better briefs for agents.', // summary
      '1', // kind
      '2', // fidelity
      '', // key flows (web app specifics, skip)
      'Product designers new to AI agents', // users
      '', // context (skip)
      'Writes a brief in under 5 minutes', '', // goals
      'Generate brief', // primary action
      '', // non-goals
      '', // stack
      '6', // tone: minimal
      'y',
    ].join('\n');
    const out = join(dir, 'BRIEF.md');
    const r = spawnSync(process.execPath, [cli, '--quick', '-o', out, '--save-answers', join(dir, 'a.json')], {
      input,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    const md = readFileSync(out, 'utf8');
    assert.match(md, /# Design brief: Demo/);
    assert.match(md, /\*\*Minimal\.\*\*/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'a.json'), 'utf8')).fidelity, 'prototype');
  });

  it('fails cleanly when input ends before required answers', () => {
    const r = spawnSync(process.execPath, [cli, '-o', join(dir, 'x.md')], { input: 'Only a name\n', encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /required questions/);
  });

  it('renders answers JSON to stdout in prompt format', () => {
    const file = join(dir, 'answers.json');
    writeFileSync(file, JSON.stringify(answers));
    const r = spawnSync(process.execPath, [cli, 'render', file, '-f', 'prompt'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^<design_brief/);
  });
});

describe('linkBrief', () => {
  const fresh = () => mkdtempSync(join(tmpdir(), 'the-lowdown-link-'));

  it('creates AGENTS.md when no instruction files exist', () => {
    const cwd = fresh();
    const results = linkBrief({ cwd });
    assert.deepEqual(results, [{ target: 'agents', file: 'AGENTS.md', action: 'created' }]);
    const text = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
    assert.match(text, /^# AGENTS\.md\n\n<!-- the-lowdown:start -->/);
    assert.ok(text.includes(linkInstruction('BRIEF.md')));
  });

  it('adds to existing files, keeps their content, and is idempotent', () => {
    const cwd = fresh();
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Project rules\n\nUse pnpm.\n');
    mkdirSync(join(cwd, '.cursor'));
    assert.deepEqual(
      linkBrief({ cwd }).map((r) => `${r.target}:${r.action}`),
      ['claude:added', 'cursor:created'],
    );
    const claude = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /^# Project rules\n\nUse pnpm\.\n\n<!-- the-lowdown:start -->/);
    assert.ok(!existsSync(join(cwd, 'AGENTS.md')), 'does not create files that were not asked for');
    assert.match(readFileSync(join(cwd, '.cursor/rules/the-lowdown.mdc'), 'utf8'), /alwaysApply: true[\s\S]*@BRIEF\.md/);

    assert.deepEqual(linkBrief({ cwd }).map((r) => r.action), ['unchanged', 'unchanged']);
    assert.equal(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8'), claude);
  });

  it('updates the block in place when the brief path changes', () => {
    const cwd = fresh();
    writeFileSync(join(cwd, 'AGENTS.md'), 'Intro\n');
    linkBrief({ cwd });
    linkBrief({ cwd, brief: 'docs/brief.md' });
    const text = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
    assert.equal(text.match(/the-lowdown:start/g)?.length, 1);
    assert.match(text, /Follow docs\/brief\.md/);
    assert.match(text, /^Intro\n/);
  });

  it('respects explicit targets and dry runs', () => {
    const cwd = fresh();
    const results = linkBrief({ cwd, targets: ['claude', 'copilot'], dryRun: true });
    assert.deepEqual(results.map((r) => r.file), ['CLAUDE.md', '.github/copilot-instructions.md']);
    assert.ok(!existsSync(join(cwd, 'CLAUDE.md')));
  });
});

describe('cli link', () => {
  const cli = fileURLToPath(new URL('./cli.js', import.meta.url));

  it('render --link writes the brief and links it', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'the-lowdown-cli-'));
    writeFileSync(join(cwd, 'answers.json'), JSON.stringify(answers));
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Rules\n');
    const r = spawnSync(process.execPath, [cli, 'render', 'answers.json', '-o', 'BRIEF.md', '--link'], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /Linked CLAUDE\.md/);
    assert.match(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8'), /Follow BRIEF\.md/);
  });

  it('link command checks the brief exists and validates targets', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'the-lowdown-cli-'));
    let r = spawnSync(process.execPath, [cli, 'link'], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /BRIEF\.md not found/);
    writeFileSync(join(cwd, 'BRIEF.md'), '# brief\n');
    r = spawnSync(process.execPath, [cli, 'link', '--link-to', 'claude,vscode'], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Unknown link target "vscode"/);
    r = spawnSync(process.execPath, [cli, 'link', '--link-to', 'claude'], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /Created CLAUDE\.md/);
  });
});

describe('share links', () => {
  it('round-trips answers through the URL hash and drops empty values', () => {
    const withEmpty = { ...answers, references: [], antiTone: '' };
    const url = shareUrl('https://example.com/brief?x=1', withEmpty);
    assert.match(url, /^https:\/\/example\.com\/brief\?x=1#a=v1\.[\w-]+$/);
    const back = answersFromHash(new URL(url).hash)!;
    assert.deepEqual(back, answers);
    assert.equal(encodeAnswers({ name: 'café — ✓' }).includes('='), false);
    assert.deepEqual(decodeAnswers(encodeAnswers({ name: 'café — ✓' })), { name: 'café — ✓' });
  });

  it('ignores missing or malformed tokens', () => {
    assert.equal(answersFromHash(''), undefined);
    assert.equal(answersFromHash('#a=garbage'), undefined);
    assert.equal(answersFromHash('#a=v1.!!!'), undefined);
    assert.throws(() => decodeAnswers('v2.abc'), /Not a the-lowdown share token/);
  });

  it('keeps the main entry free of Node built-ins', () => {
    const src = readFileSync(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8');
    assert.doesNotMatch(src, /from ['"]node:|\.\/link\.js|\.\/cli\.js/);
  });
});

// ── Interview and questions ──────────────────────────────────

import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { applyConfig, matchesCondition, parseReference, rankItems, validateConfig } from './index.js';
import { createMenu, menuReducer, renderMenu } from './menu.js';
import { LowdownForm } from './react.js';

describe('scale and rank questions', () => {
  const scale: Question = { id: 'density', section: 'x', type: 'scale', prompt: 'How dense?', min: 1, max: 5, minLabel: 'Spacious', maxLabel: 'Dense' };
  const rank: Question = { id: 'order', section: 'x', type: 'rank', rankFrom: 'goals', prompt: 'Order them' };

  it('parses and validates scale answers', () => {
    assert.equal(parseInput(scale, '4'), 4);
    const s = new BriefSession({ questions: [scale] });
    assert.equal(s.answerText('9').ok, false);
    assert.equal(s.answerText('three').ok, false);
    assert.ok(s.answerText('2').ok);
    assert.equal(s.answers.density, 2);
  });

  it('ranks the items of another answer, by number or text, keeping unranked items last', () => {
    const answers = { goals: ['Fast', 'Accurate', 'Delightful'] };
    assert.deepEqual(rankItems(rank, answers), ['Fast', 'Accurate', 'Delightful']);
    assert.deepEqual(parseInput(rank, '2,3', answers), ['Accurate', 'Delightful', 'Fast']);
    assert.deepEqual(parseInput(rank, 'delightful', answers), ['Delightful', 'Fast', 'Accurate']);
  });

  it('asks for a goal ranking only with two or more goals, and renders it numbered', () => {
    const one = new BriefSession({ answers: { ...answers } });
    assert.ok(!one.applicable().some((q) => q.id === 'goalPriority'));
    const two = { ...answers, goals: ['Book in under 60 seconds', 'Fewer support tickets'], goalPriority: '2' };
    assert.ok(new BriefSession({ answers: two }).applicable().some((q) => q.id === 'goalPriority'));
    const b = buildBrief({ ...two, goalPriority: ['Fewer support tickets'] }, { now: NOW });
    assert.equal(b.goals.ranked, true);
    assert.deepEqual(b.goals.successCriteria, ['Fewer support tickets', 'Book in under 60 seconds']);
    assert.match(renderBrief(b), /in priority order[\s\S]*1\. Fewer support tickets\n2\. Book in under 60 seconds/);
  });
});

describe('project-type questions', () => {
  it('asks dashboard questions only for dashboards', () => {
    const ids = (kind: string) => new BriefSession({ answers: { ...answers, kind } }).applicable().filter((q) => q.section === 'specifics').map((q) => q.id);
    assert.deepEqual(ids('dashboard'), ['keyMetrics', 'dataDensity', 'freshness']);
    assert.deepEqual(ids('marketing-site'), ['conversionGoal', 'trafficSource', 'proofPoints']);
    assert.deepEqual(ids('Something custom'), []);
  });

  it('renders specifics with readable values and adds them to the definition of done', () => {
    const b = buildBrief({ ...answers, kind: 'dashboard', keyMetrics: 'Weekly bookings; No-show rate', dataDensity: 4, freshness: 'daily' }, { now: NOW });
    assert.deepEqual(b.specifics?.map((x) => x.id), ['keyMetrics', 'dataDensity', 'freshness']);
    const md = renderBrief(b);
    assert.match(md, /## Project specifics \(Dashboard \/ data UI\)/);
    assert.match(md, /\*\*How dense should it be:\*\* 4 of 5 \(1 = Spacious, 5 = Dense\)/);
    assert.match(md, /\*\*How fresh is the data:\*\* Daily/);
    assert.match(md, /- \[ \] The key metrics are visible without scrolling/);
    assert.match(renderBrief(b, 'prompt'), /<project_specifics>[\s\S]*Which numbers matter most: Weekly bookings, No-show rate/);
  });

  it('nudges when a marketing page has no conversion goal', () => {
    const b = buildBrief({ ...answers, kind: 'marketing-site' }, { now: NOW });
    assert.ok(lintBrief(b).some((i) => i.field === 'specifics.conversionGoal'));
  });
});

describe('new brief fields', () => {
  const full = {
    ...answers,
    secondaryUsers: ['Clinic staff who confirm bookings'],
    content: 'none',
    brandAssets: ['Logo: brand.example.com/logo.svg'],
    crossCutting: ['Dark mode', 'Localization'],
    references: ['Headspace — the calm pacing', 'Linear'],
  };

  it('renders secondary users, content, brand assets, cross-cutting needs and references', () => {
    const md = renderBrief(buildBrief(full, { now: NOW }));
    assert.match(md, /Also used by[\s\S]*- Clinic staff who confirm bookings/);
    assert.match(md, /\*\*Content \(No content yet\):\*\* Write realistic placeholder copy/);
    assert.match(md, /\*\*Brand assets:\*\*\n\n- Logo: brand\.example\.com\/logo\.svg/);
    assert.match(md, /\*\*Applies everywhere \(must\):\*\*\n\n- Dark mode\n- Localization/);
    assert.match(md, /- \*\*Headspace:\*\* borrow the calm pacing\n- Linear/);
    assert.match(md, /- \[ \] Supports: Dark mode/);
    assert.match(md, /- \[ \] No lorem ipsum/);
  });

  it('parses references and flags ones without anything to borrow', () => {
    assert.deepEqual(parseReference('Linear: the density'), { name: 'Linear', borrow: 'the density' });
    assert.deepEqual(parseReference('Stripe – clear pricing'), { name: 'Stripe', borrow: 'clear pricing' });
    assert.deepEqual(parseReference('Notion'), { name: 'Notion' });
    const tips = lintBrief(buildBrief(full, { now: NOW })).filter((i) => i.field === 'tone.references');
    assert.equal(tips.length, 1);
    assert.match(tips[0]!.message, /Linear/);
  });

  it('still renders briefs saved before these fields existed', () => {
    const b = buildBrief(answers, { now: NOW }) as unknown as Record<string, any>;
    delete b.specifics; delete b.users.secondary; delete b.constraints.brandAssets; delete b.constraints.crossCutting;
    assert.doesNotThrow(() => renderBrief(b as never));
    assert.doesNotThrow(() => lintBrief(b as never));
  });
});

describe('conditions', () => {
  it('matches values, lists, alternatives and "answered"', () => {
    assert.ok(matchesCondition({ kind: 'dashboard' }, { kind: 'Dashboard' }));
    assert.ok(matchesCondition({ kind: ['web-app', 'dashboard'] }, { kind: 'dashboard' }));
    assert.ok(matchesCondition({ crossCutting: 'Dark mode' }, { crossCutting: ['Dark mode', 'Localization'] }));
    assert.ok(matchesCondition({ stack: '*' }, { stack: 'React' }));
    assert.ok(!matchesCondition({ stack: '*' }, {}));
    assert.ok(matchesCondition({ hasBrand: true }, { hasBrand: true }));
    assert.ok(!matchesCondition({ hasBrand: true }, { hasBrand: false }));
    assert.ok(!matchesCondition({ kind: 'dashboard' }, { kind: 'web-app' }));
  });
});

describe('team config', () => {
  const config = {
    defaults: { platforms: ['Mobile web'] },
    answers: { stack: 'React + @acme/ui' },
    skip: ['references'],
    overrides: {
      primaryUsers: { prompt: '¿Quién es el usuario principal?' },
      fidelity: { choiceLabels: { sketch: 'Boceto' } },
    },
    sections: { tone: 'Look and feel', brand: { title: 'Brand', intro: 'Your brand' } },
    questions: [
      { id: 'hasBrand', section: 'brand', type: 'confirm' as const, prompt: 'Existing brand?' },
      { id: 'brandUrl', section: 'brand', type: 'text' as const, prompt: 'Brand guidelines URL', condition: { hasBrand: true } },
      { id: 'owner', section: 'project', type: 'text' as const, prompt: 'Who signs off?', after: 'name' },
    ],
  };

  it('validates', () => {
    assert.deepEqual(validateConfig(config), []);
    const errs = validateConfig({ skip: ['name', 'nope'], overrides: { ghost: {} }, questions: [{ id: 'name', section: 'x', type: 'text', prompt: 'Dup' }, { id: 'z', section: 'x', type: 'wat', prompt: 'p' }] });
    assert.ok(errs.some((e) => /"name" is required/.test(e)));
    assert.ok(errs.some((e) => /no question has the id "nope"/.test(e)));
    assert.ok(errs.some((e) => /overrides\.ghost/.test(e)));
    assert.ok(errs.some((e) => /id "name" is already used/.test(e)));
    assert.ok(errs.some((e) => /type must be one of/.test(e)));
  });

  it('rewords, adds, skips, defaults and pre-answers questions', () => {
    const { questions, sections, answers: fixed } = applyConfig(config);
    const ids = questions.map((q) => q.id);
    assert.equal(ids[ids.indexOf('name') + 1], 'owner');
    assert.ok(!ids.includes('references'));
    assert.equal(questions.find((q) => q.id === 'primaryUsers')!.prompt, '¿Quién es el usuario principal?');
    assert.equal(questions.find((q) => q.id === 'fidelity')!.choices![0]!.label, 'Boceto');
    assert.deepEqual(questions.find((q) => q.id === 'platforms')!.default, ['Mobile web']);
    assert.equal(sections.find((x) => x.id === 'tone')!.title, 'Look and feel');
    assert.equal(sections.find((x) => x.id === 'brand')!.intro, 'Your brand');
    const s = new BriefSession({ questions, sections, answers: { ...answers, ...fixed, hasBrand: false } });
    assert.ok(!s.applicable().some((q) => q.id === 'brandUrl'));
    assert.ok(!s.applicable().some((q) => q.id === 'stack' && !(q.id in s.answers)));
  });

  it('is picked up by the CLI from .lowdownrc.json', () => {
    const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
    const cwd = mkdtempSync(join(tmpdir(), 'the-lowdown-rc-'));
    writeFileSync(join(cwd, '.lowdownrc.json'), JSON.stringify({ quick: true, out: 'docs-brief.md', answers: { stack: 'React' }, questions: [{ id: 'owner', section: 'project', type: 'text', prompt: 'Who signs off', after: 'summary', quick: true }] }));
    const input = ['Demo', 'A small tool for writing briefs for agents.', 'Anna', '1', '2', '', 'Designers', '', 'Writes a brief in 5 minutes', '', 'Generate', '', '6', 'y'].join('\n');
    const r = spawnSync(process.execPath, [cli], { cwd, input, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /Using \.lowdownrc\.json/);
    const md = readFileSync(join(cwd, 'docs-brief.md'), 'utf8');
    assert.match(md, /\*\*Who signs off:\*\* Anna/);
    assert.match(md, /\*\*Stack \/ design system:\*\* React/);
  });
});

describe('arrow-key menu', () => {
  const items = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' }];

  it('single: moves, wraps and submits the highlighted item', () => {
    let s = createMenu({ mode: 'single', items });
    s = menuReducer(s, { name: 'up' }).state; // wraps to last
    assert.equal(s.cursor, 2);
    const r = menuReducer(menuReducer(s, { name: 'down' }).state, { name: 'enter' });
    assert.deepEqual(r.result, { action: 'submit', value: 'a' });
  });

  it('multi: toggles with space, respects max and submits in item order', () => {
    let s = createMenu({ mode: 'multi', items, max: 2 });
    for (const d of [3, 1, 2]) s = menuReducer(s, { name: 'digit', digit: d }).state;
    assert.deepEqual(s.picked, ['c', 'a']);
    assert.equal(s.note, 'Pick at most 2.');
    assert.deepEqual(menuReducer(s, { name: 'enter' }).result, { action: 'submit', value: ['a', 'c'] });
  });

  it('order: picks in priority order and shows the numbers', () => {
    let s = createMenu({ mode: 'order', items });
    s = menuReducer(s, { name: 'digit', digit: 3 }).state;
    s = menuReducer(s, { name: 'digit', digit: 1 }).state;
    assert.match(renderMenu(s).join('\n'), / 2 Alpha[\s\S]* 1 Gamma/);
    assert.deepEqual(menuReducer(s, { name: 'enter' }).result, { action: 'submit', value: ['c', 'a'] });
  });

  it('offers skip, type-your-own, back and help', () => {
    let s = createMenu({ mode: 'single', items, optional: true, allowOther: true });
    assert.equal(renderMenu(s).filter((l) => /Type your own|Skip/.test(l)).length, 2);
    s = menuReducer(s, { name: 'end' }).state;
    assert.deepEqual(menuReducer(s, { name: 'enter' }).result, { action: 'skip' });
    s = menuReducer(s, { name: 'up' }).state;
    assert.equal(menuReducer(s, { name: 'enter' }).result?.action, 'other');
    assert.deepEqual(menuReducer(s, { name: 'back' }).result, { action: 'back' });
    const req = createMenu({ mode: 'multi', items });
    assert.match(menuReducer(req, { name: 'enter' }).state.note ?? '', /at least one/);
  });
});

describe('react form: new question types', () => {
  it('renders scale and rank fields', () => {
    const scaleHtml = renderToString(createElement(LowdownForm, { questions: [{ id: 'd', section: 'x', type: 'scale', prompt: 'How dense?', minLabel: 'Spacious', maxLabel: 'Dense' }] }));
    assert.match(scaleHtml, /role="radiogroup"/);
    assert.match(scaleHtml, /aria-label="1, Spacious"/);
    const rankHtml = renderToString(createElement(LowdownForm, {
      questions: [{ id: 'goals', section: 'g', type: 'list', prompt: 'Goals' }, { id: 'p', section: 'g', type: 'rank', rankFrom: 'goals', prompt: 'Order' }],
      initialAnswers: { goals: ['Fast', 'Clear'] },
    }));
    assert.match(rankHtml, /Move “Fast” down/);
    assert.match(rankHtml, /Move “Clear” up/);
  });
});

const rich: Answers = {
  ...answers,
  kind: 'dashboard',
  fidelity: 'production',
  userContext: 'On a phone, between school pickup and dinner',
  secondaryUsers: ['Clinic front-desk staff'],
  accessibility: ['WCAG 2.2 AA'],
  goals: ['Book a session in under 60 seconds', 'No support tickets about booking'],
  goalPriority: ['No support tickets about booking', 'Book a session in under 60 seconds'],
  keyMetrics: ['Bookings per day'],
  dataDensity: 4,
  platforms: ['Desktop web', 'Mobile web'],
  stack: 'Next.js + Tailwind',
  mustInclude: ['Empty, loading and error states'],
  mustAvoid: ['Modals on mobile'],
  references: ['Calendly — the one-screen time picker'],
};

describe('reading a Markdown brief back', () => {
  const brief = buildBrief(rich, { now: NOW });

  it('round-trips the rendered Markdown without losing anything', () => {
    const md = toMarkdown(brief, { frontmatter: true });
    const back = readBrief(md);
    assert.equal(back.source, 'markdown');
    assert.equal(toMarkdown(back.brief, { frontmatter: true }), md);
    assert.deepEqual(diffBriefs(brief, back.brief), []);
  });

  it('writes and reads frontmatter', () => {
    const md = toMarkdown(brief, { frontmatter: true });
    assert.match(md, /^---\nbrief: the-lowdown\nschema: 1\nproject: HealthHub onboarding\ncreated: 2026-11-05\n---\n/);
    assert.equal(stripFrontmatter(md).data.created, '2026-11-05');
    assert.ok(!/^---/.test(toMarkdown(brief)), 'frontmatter is off by default');
    assert.ok(isMarkdownBrief(md) && isMarkdownBrief(toMarkdown(brief)));
    assert.ok(!isMarkdownBrief('# Shopping list\n\n- eggs'));
  });

  it('picks up hand edits, including labels moved to another section', () => {
    let md = toMarkdown(brief);
    md = md.replace('**Primary user:** Busy parents booking care on their phone', '**Primary user:** Grandparents booking for the family');
    md = md.replace('- Payments\n', '');
    md = md.replace('## Constraints', '**Must avoid:**\n\n- Carousels\n\n## Constraints'); // under the wrong heading
    const { answers: a } = parseMarkdownBrief(md);
    assert.equal(a.primaryUsers, 'Grandparents booking for the family');
    assert.deepEqual(a.nonGoals, ['Account settings']);
    assert.ok(Array.isArray(a.mustAvoid));
  });

  it('reads tone words with custom guidance', () => {
    const toneGuidance = { cozy: { label: 'Cozy', do: 'Warm neutrals', avoid: 'Stark white' } };
    const b = buildBrief({ ...answers, tone: ['calm', 'cozy'] }, { now: NOW, toneGuidance });
    const md = toMarkdown(b);
    assert.match(md, /\*\*Cozy\.\*\* Do: Warm neutrals/);
    const back = parseMarkdownBrief(md);
    assert.deepEqual(back.answers.tone, ['calm', 'cozy']);
    assert.match(back.toneGuidance.cozy?.avoid ?? '', /^Stark white\.?$/);
  });

  it('reads brief JSON and answers JSON too', () => {
    assert.equal(readBrief(JSON.stringify(brief)).source, 'brief-json');
    assert.equal(readBrief(JSON.stringify(rich)).source, 'answers-json');
  });
});

describe('HTML export', () => {
  it('converts the brief Markdown subset', () => {
    const html = markdownToHtml('# Title\n\n> Quote\n\n**Bold:** `code` [link](https://x.dev)\n\n- a\n- [x] done\n\n1. one');
    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /<blockquote>/);
    assert.match(html, /<strong>Bold:<\/strong> <code>code<\/code> <a href="https:\/\/x\.dev">link<\/a>/);
    assert.match(html, /<ul>[\s\S]*<li>a<\/li>/);
    assert.match(html, /<ol>[\s\S]*<li>one<\/li>/);
  });

  it('escapes HTML in answers', () => {
    const html = toHTML(buildBrief({ ...answers, primaryUsers: '<script>alert(1)</script> parents' }, { now: NOW }));
    assert.ok(!html.includes('<script>alert'));
    assert.match(html, /&lt;script&gt;/);
  });

  it('is a standalone, print-ready page', () => {
    const html = renderBrief(buildBrief(answers, { now: NOW }), 'html');
    assert.match(html, /^<!DOCTYPE html>/i);
    assert.match(html, /<title>[^<]*HealthHub onboarding/);
    assert.match(html, /@media print|@page/);
    assert.ok(!/^---/m.test(html.split('<body')[1] ?? ''), 'no frontmatter in the page');
  });
});

describe('diffBriefs', () => {
  it('reports scalar, list and reorder changes', () => {
    const a = buildBrief(answers, { now: NOW });
    const b = buildBrief({ ...answers, primaryUsers: 'Clinic staff', nonGoals: ['Account settings', 'Dark mode'], tone: ['warm', 'calm'] }, { now: NOW });
    const changes = diffBriefs(a, b);
    const by = (label: RegExp) => changes.find((c) => label.test(c.label));
    assert.ok(by(/primary user/i));
    const ng = by(/out of scope/i) as Extract<ReturnType<typeof diffBriefs>[number], { kind: 'list' }>;
    assert.deepEqual(ng.added, ['Dark mode']);
    assert.deepEqual(ng.removed, ['Payments']);
    assert.deepEqual(diffBriefs(a, a), []);
  });
});

describe('scoreBrief', () => {
  it('scores a thin brief low and a full one high', () => {
    const thin = scoreBrief(buildBrief({ name: 'X', summary: 'A thing.', primaryUsers: 'Everyone', goals: ['Feels intuitive'], primaryAction: 'Go' }, { now: NOW, strict: false }));
    const full = scoreBrief(buildBrief({ ...rich, nonGoals: ['Payments'], tone: ['calm', 'warm'] }, { now: NOW }));
    assert.ok(thin.score < 50, `thin ${thin.score}`);
    assert.equal(thin.grade, 'Thin');
    assert.ok(full.score >= 80, `full ${full.score}`);
    assert.ok(full.score <= 100 && thin.score >= 0);
    assert.equal(full.parts.reduce((n, p) => n + p.max, 0), 100);
  });

  it('gives tips that do not repeat lint messages', () => {
    const b = buildBrief({ ...answers, primaryUsers: 'Everyone' }, { now: NOW });
    const msgs = new Set(lintBrief(b).map((i) => i.message));
    const tips = scoreTips(scoreBrief(b));
    assert.ok(tips.length > 0 && tips.length <= 2);
    assert.ok(tips.every((t) => !msgs.has(t)));
  });
});

describe('new lint checks', () => {
  const ids = (a: Answers) => lintBrief(buildBrief(a, { now: NOW, strict: false })).map((i) => `${i.level}:${i.field}:${i.message}`);

  it('flags a platform the stack cannot build', () => {
    assert.ok(ids({ ...answers, platforms: ['iOS'], stack: 'Next.js + Tailwind' }).some((m) => /iOS/.test(m) && /web/.test(m)));
    assert.ok(ids({ ...answers, platforms: ['Desktop web'], stack: 'SwiftUI' }).some((m) => /^warn:constraints\.stack/.test(m)));
    assert.ok(!ids({ ...answers, platforms: ['iOS'], stack: 'React Native' }).some((m) => /constraints\.stack/.test(m)));
  });

  it('asks for states at production fidelity', () => {
    assert.ok(ids({ ...answers, fidelity: 'production' }).some((m) => /states that matter/.test(m)));
    assert.ok(!ids({ ...answers, fidelity: 'production', mustInclude: ['Empty and error states'] }).some((m) => /states that matter/.test(m)));
  });

  it('flags too many success criteria', () => {
    const goals = ['a 1', 'b 2', 'c 3', 'd 4', 'e 5', 'f 6'];
    assert.ok(ids({ ...answers, goals }).some((m) => /^warn:goals/.test(m) && /6/.test(m)));
    assert.ok(ids({ ...answers, goals, goalPriority: goals }).some((m) => /^info:goals/.test(m) && /6/.test(m)));
  });

  it('flags an item that is both a must and out of scope', () => {
    assert.ok(ids({ ...answers, mustInclude: ['Payments'], nonGoals: ['Payments'] }).some((m) => /^warn:/.test(m) && /Payments/.test(m)));
  });
});

describe('config: bring-your-own tone words', () => {
  const tones = { cozy: { label: 'Cozy', hint: 'Like a reading nook', do: 'Warm neutrals, soft corners', avoid: 'Stark white, sharp edges' } };

  it('validates them', () => {
    assert.deepEqual(validateConfig({ tones }), []);
    assert.ok(validateConfig({ tones: { bad: { label: 'Bad' } } as never }).some((e) => /tones\.bad/.test(e)));
  });

  it('adds the choice and its guidance to the brief', () => {
    const { questions, toneGuidance } = applyConfig({ tones });
    assert.ok(questions.find((q) => q.id === 'tone')!.choices!.some((c) => c.value === 'cozy' && c.label === 'Cozy'));
    const s = new BriefSession({ questions, answers: { ...answers, tone: ['cozy'] }, toneGuidance });
    const md = toMarkdown(s.toBrief(NOW));
    assert.match(md, /\*\*Should feel:\*\* Cozy/);
    assert.match(md, /\*\*Cozy\.\*\* Do: Warm neutrals, soft corners\. Avoid: Stark white, sharp edges/);
    assert.match(renderBrief(s.toBrief(NOW), 'prompt'), /Warm neutrals, soft corners/);
  });
});

describe('cli: edit, diff, lint, html', () => {
  const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
  const run = (args: string[], cwd: string, input?: string) => spawnSync(process.execPath, [cli, ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  const setup = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'the-lowdown-edit-'));
    writeFileSync(join(cwd, 'answers.json'), JSON.stringify(answers));
    assert.equal(run(['render', 'answers.json', '-o', 'BRIEF.md'], cwd).status, 0);
    return cwd;
  };

  it('renders Markdown files with frontmatter unless told not to', () => {
    const cwd = setup();
    assert.match(readFileSync(join(cwd, 'BRIEF.md'), 'utf8'), /^---\nbrief: the-lowdown/);
    assert.equal(run(['render', 'answers.json', '-o', 'plain.md', '--no-frontmatter'], cwd).status, 0);
    assert.match(readFileSync(join(cwd, 'plain.md'), 'utf8'), /^# Design brief/);
  });

  it('lints a Markdown brief and shows its strength', () => {
    const cwd = setup();
    const r = run(['lint', 'BRIEF.md'], cwd);
    assert.match(r.stdout + r.stderr, /Brief strength: \d+\/100/);
  });

  it('diffs two briefs and exits 1 when they differ', () => {
    const cwd = setup();
    const md = readFileSync(join(cwd, 'BRIEF.md'), 'utf8');
    writeFileSync(join(cwd, 'v2.md'), md.replace('Busy parents booking care on their phone', 'Clinic staff'));
    let r = run(['diff', 'BRIEF.md', 'BRIEF.md'], cwd);
    assert.equal(r.status, 0);
    r = run(['diff', 'BRIEF.md', 'v2.md'], cwd);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /Primary user[\s\S]*- Busy parents[\s\S]*\+ Clinic staff/);
    r = run(['diff', 'answers.json', 'BRIEF.md'], cwd);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it('edits only the sections asked for and keeps the rest', () => {
    const cwd = setup();
    const before = readFileSync(join(cwd, 'BRIEF.md'), 'utf8');
    // goals section: goals (keep default with an empty line? no: replace), primary action (keep), non-goals (keep)
    const r = run(['edit', '--only', 'goals', '-y', '--plain'], cwd, ['Book a session in under 45 seconds', '', '', '', ''].join('\n'));
    assert.equal(r.status, 0, r.stderr);
    const after = readFileSync(join(cwd, 'BRIEF.md'), 'utf8');
    assert.match(after, /- Book a session in under 45 seconds/);
    assert.match(after, /- Payments/);
    assert.match(after, /\*\*Primary user:\*\* Busy parents booking care on their phone/);
    assert.equal(after.split('\n').length, before.split('\n').length);
    assert.match(after, /created: 2026-11-05|created: \d{4}-\d{2}-\d{2}/);
    assert.ok(!/What is your situation|Their situation/.test(after.replace(before, '')));
  });

  it('rejects an unknown --only section', () => {
    const cwd = setup();
    const r = run(['edit', '--only', 'nope', '-y'], cwd, '');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no section or question called nope/);
  });

  it('exports HTML, with pdf as an alias', () => {
    const cwd = setup();
    assert.equal(run(['render', 'BRIEF.md', '-o', 'brief.html'], cwd).status, 0);
    assert.match(readFileSync(join(cwd, 'brief.html'), 'utf8'), /^<!DOCTYPE html>/i);
    const r = run(['render', 'BRIEF.md', '-f', 'pdf'], cwd);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /<!DOCTYPE html>/i);
  });
});

// ── AI assistance ────────────────────────────────────────────

const PRD = `# PRD: Coach Finder

[![build](https://x/badge.svg)](https://x)

Coach Finder helps new HealthHub members find a coach who fits their schedule and book a first session from their phone.

## Who it's for

Busy parents who joined in the last month and haven't booked yet.

## Goals

- Book a first session in under 2 minutes
- Fewer than 5% of bookings need support

## Non-goals

- Payments
- Coach reviews

## Tech stack

- Next.js
- Tailwind
`;

describe('follow-ups', () => {
  it('asks one more question for vague answers only', () => {
    assert.ok(followUpFor(q('primaryUsers'), 'Everyone'));
    assert.ok(followUpFor(q('primaryUsers'), 'Parents'));
    assert.equal(followUpFor(q('primaryUsers'), 'Busy parents booking care on their phone'), undefined);
    assert.ok(followUpFor(q('summary'), 'An app'));
    assert.ok(followUpFor(q('primaryAction'), 'Book, cancel or reschedule'));
    assert.equal(followUpFor(q('primaryAction'), 'Book a session'), undefined);
    assert.equal(followUpFor(q('tone'), ['calm']), undefined);
  });

  it('merges the reply into the answer', () => {
    const fu = followUpFor(q('goals'), ['Books in under a minute', 'Feels intuitive'])!;
    assert.equal(fu.item, 'Feels intuitive');
    assert.deepEqual(fu.merge(['Books in under a minute', 'Feels intuitive'], 'Books without help'), ['Books in under a minute', 'Books without help']);
    assert.deepEqual(fu.merge(['Feels intuitive'], '  '), ['Feels intuitive'], 'an empty reply keeps the answer');
    const users = followUpFor(q('primaryUsers'), 'Everyone')!;
    assert.equal(users.merge('Everyone', 'Clinic front-desk staff'), 'Clinic front-desk staff');
  });

  it('session.set changes any answer without moving on', () => {
    const s = new BriefSession({ answers: { ...answers } });
    const before = s.current()?.id;
    assert.deepEqual(s.set('primaryUsers', 'Clinic staff'), { ok: true });
    assert.equal(s.answers.primaryUsers, 'Clinic staff');
    assert.equal(s.current()?.id, before);
    assert.equal(s.set('fidelity', 'nonsense').ok, false);
    assert.equal(s.set('nope', 'x').ok, false);
    s.set('nonGoals', undefined);
    assert.ok(!('nonGoals' in s.answers));
  });

  it('maps brief-check fields to questions', () => {
    assert.equal(questionForField('users.primary'), 'primaryUsers');
    assert.equal(questionForField('goals.successCriteria'), 'goals');
    assert.equal(questionForField('specifics.keyMetrics'), 'keyMetrics');
    assert.equal(questionForField('constraints'), undefined);
  });
});

describe('drafting from a document without AI', () => {
  it('reads a PRD', () => {
    const a = draftFromText(PRD);
    assert.equal(a.name, 'Coach Finder');
    assert.match(String(a.summary), /^Coach Finder helps new HealthHub members/);
    assert.deepEqual(a.goals, ['Book a first session in under 2 minutes', 'Fewer than 5% of bookings need support']);
    assert.deepEqual(a.nonGoals, ['Payments', 'Coach reviews']);
    assert.match(String(a.primaryUsers), /^Busy parents/);
    assert.equal(a.stack, 'Next.js, Tailwind');
  });

  it('reads an HTML page', () => {
    const html = '<html><head><style>p{}</style><script>evil()</script></head><body><h1>Coach Finder</h1><p>Helps new members find a coach &amp; book a session from their phone.</p><h2>Out of scope</h2><ul><li>Payments</li></ul></body></html>';
    const text = htmlToText(html);
    assert.ok(!/evil|<p>/.test(text));
    assert.match(text, /^# Coach Finder/);
    const a = draftFromText(html);
    assert.equal(a.name, 'Coach Finder');
    assert.match(String(a.summary), /coach & book/);
    assert.deepEqual(a.nonGoals, ['Payments']);
  });

  it('finds nothing in a document with no structure', () => {
    assert.deepEqual(draftFromText('hello'), {});
  });
});

/** A fake model: replies by matching the system prompt, and records every request. */
function fakeModel(replies: Array<[RegExp, unknown]>, cost = 0.001) {
  const calls: Parameters<Complete>[0][] = [];
  const complete: Complete = async (req) => {
    calls.push(req);
    const hit = replies.find(([re]) => re.test(req.system));
    return { text: hit ? (typeof hit[1] === 'string' ? hit[1] : '```json\n' + JSON.stringify(hit[1]) + '\n```') : '{}', costUsd: cost };
  };
  return { complete, calls };
}

describe('assistant', () => {
  it('drafts answers and drops anything that does not fit a question', async () => {
    const m = fakeModel([[/pre-fill/, { answers: { name: 'Coach Finder', kind: 'mobile-app', fidelity: 'nonsense', goals: 'Book in under 2 minutes', ghost: 'x' }, notes: ['Platforms not stated.'] }]]);
    const a = createAssistant({ complete: m.complete });
    const d = await a.draftAnswers(PRD, { source: 'PRD.md' });
    assert.deepEqual(d.answers, { name: 'Coach Finder', kind: 'mobile-app', goals: ['Book in under 2 minutes'] });
    assert.deepEqual(d.notes, ['Platforms not stated.']);
    assert.equal(m.calls[0]!.model, 'claude-sonnet-5-5');
    assert.match(m.calls[0]!.user, /<document source="PRD.md">/);
    assert.ok(Math.abs(a.spent - 0.001) < 1e-9);
  });

  it('suggests rewrites only for flagged answers, and only real changes', async () => {
    const m = fakeModel([[/tighten a design brief/, { rewrites: [
      { id: 'primaryUsers', value: 'Busy parents booking care on their phone', why: 'One person, one situation.' },
      { id: 'goals', value: ['Feels intuitive'] }, // unchanged: dropped
      { id: 'tone', value: ['calm'] }, // not flagged: dropped
      { id: 'kind', value: 'nonsense' },
    ] }]]);
    const a = createAssistant({ complete: m.complete });
    const weak = { ...answers, primaryUsers: 'Everyone', goals: ['Feels intuitive'] };
    const rewrites = await a.suggestRewrites(buildBrief(weak, { now: NOW }), weak);
    assert.deepEqual(rewrites.map((r) => r.questionId), ['primaryUsers']);
    assert.equal(rewrites[0]!.current, 'Everyone');
    assert.match(rewrites[0]!.issue, /too broad/);
    assert.equal(m.calls[0]!.model, 'claude-haiku-5-5');
  });

  it('tailors follow-ups and merges replies', async () => {
    const m = fakeModel([[/ONE short follow-up/, { question: 'Which parents, and when do they book?' }], [/Combine/, { value: 'Working parents booking in the evening' }]]);
    const a = createAssistant({ complete: m.complete, model: 'claude-opus-5-5' });
    const fu = followUpFor(q('primaryUsers'), 'Parents')!;
    assert.equal(await a.followUpQuestion(fu, 'Parents', answers), 'Which parents, and when do they book?');
    assert.equal(await a.mergeFollowUp(fu, 'Parents', 'Which parents?', 'working ones, evenings', answers), 'Working parents booking in the evening');
    assert.ok(m.calls.every((c) => c.model === 'claude-opus-5-5'));
  });

  it('retries once when the reply is not JSON', async () => {
    let n = 0;
    const a = createAssistant({ complete: async () => ({ text: n++ ? '{"question":"Who exactly?"}' : 'Sure! Here you go.', costUsd: 0 }) });
    assert.equal(await a.followUpQuestion(followUpFor(q('primaryUsers'), 'Everyone')!, 'Everyone', answers), 'Who exactly?');
    assert.equal(n, 2);
  });

  it('stops at the budget before calling the model', async () => {
    const m = fakeModel([[/pre-fill/, { answers: {} }]]);
    const a = createAssistant({ complete: m.complete, budget: 0.001 });
    await assert.rejects(a.draftAnswers(PRD), BudgetError);
    assert.equal(m.calls.length, 0);
    const b = createAssistant({ complete: m.complete, budget: 1 });
    await b.draftAnswers(PRD);
    assert.ok(m.calls[0]!.maxCostUsd! <= 1);
  });
});

describe('AI providers', () => {
  it('calls the Messages API with fetch and prices the reply', async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1_000_000, output_tokens: 0 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await anthropicApi({ apiKey: 'k\n', baseUrl: 'http://x/', fetch: fake })({ system: 's', user: 'u', model: 'claude-haiku-5-5', maxTokens: 10 });
    assert.equal(r.text, 'hi');
    assert.equal(r.costUsd, 0.1);
    assert.equal(sent!.url, 'http://x/v1/messages');
    assert.equal((sent!.init.headers as Record<string, string>)['x-api-key'], 'k\n');
    assert.deepEqual(JSON.parse(String(sent!.init.body)).messages, [{ role: 'user', content: 'u' }]);
  });

  it('explains a rejected key', async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })) as unknown as typeof fetch;
    await assert.rejects(anthropicApi({ apiKey: 'bad', fetch: fake })({ system: 's', user: 'u', model: 'm', maxTokens: 1 }), /ANTHROPIC_API_KEY.*invalid x-api-key/s);
  });

  it('reuses a Claude Code login as a plain completion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'the-lowdown-claude-'));
    const bin = join(dir, 'claude');
    writeFileSync(bin, `#!/usr/bin/env node
let input = ''; process.stdin.on('data', (d) => (input += d)); process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  require('fs').writeFileSync(${JSON.stringify(join(dir, 'args.json'))}, JSON.stringify({ args, input }));
  const out = input === 'logged out' ? { type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' } : { type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.02 };
  console.log(JSON.stringify(out));
});
`);
    chmodSync(bin, 0o755);
    writeFileSync(join(dir, 'package.json'), '{"type":"commonjs"}');
    const complete = claudeCode({ bin });
    const r = await complete({ system: 'sys', user: 'hello', model: 'claude-haiku-5-5', maxTokens: 10, maxCostUsd: 0.2 });
    assert.deepEqual(r, { text: 'ok', costUsd: 0.02 });
    const { args, input } = JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'));
    assert.equal(input, 'hello');
    for (const [flag, value] of [['--model', 'claude-haiku-5-5'], ['--system-prompt', 'sys'], ['--tools', ''], ['--setting-sources', ''], ['--max-budget-usd', '0.20'], ['--output-format', 'json']]) {
      assert.equal(args[args.indexOf(flag) + 1], value, flag);
    }
    assert.ok(args.includes('--no-session-persistence') && args.includes('--strict-mcp-config') && args.includes('-p'));
    await assert.rejects(complete({ system: 's', user: 'logged out', model: 'm', maxTokens: 1 }), /run \/login/);
    await assert.rejects(claudeCode({ bin: join(dir, 'missing') })({ system: 's', user: 'u', model: 'm', maxTokens: 1 }), /isn't installed/);
  });

  it('reads a source file or URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'the-lowdown-src-'));
    writeFileSync(join(dir, 'p.html'), '<h1>Title</h1><p>Body text</p>');
    assert.match(await readSource(join(dir, 'p.html')), /^# Title\n\nBody text/);
    await assert.rejects(readSource(join(dir, 'nope.md')), /not found/);
    await assert.rejects(readSource(join(dir, 'x.pdf')), /not found|text or Markdown/);
    const fake = (async () => new Response('<!doctype html><h1>Web</h1>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    assert.match(await readSource('https://example.com/prd', fake), /^# Web/);
  });

  it('validates the ai config', () => {
    assert.deepEqual(validateConfig({ ai: { budget: 0.5, models: { draft: 'claude-opus-5-5' } }, followUps: false }), []);
    assert.deepEqual(validateConfig({ ai: false }), []);
    const errs = validateConfig({ ai: { budget: -1, models: { other: 'x' } } as never, followUps: 'yes' as never });
    assert.equal(errs.length, 3);
  });
});

describe('cli: AI assistance', () => {
  const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
  /** spawn without blocking, so the mock API in this process can answer. */
  const run = (args: string[], cwd: string, input: string, env: Record<string, string | undefined> = {}) =>
    new Promise<{ status: number | null; out: string; file: (n: string) => string }>((resolve) => {
      const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, NO_COLOR: '1', ANTHROPIC_API_KEY: undefined, ...env } as NodeJS.ProcessEnv });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (status) => resolve({ status, out, file: (n) => readFileSync(join(cwd, n), 'utf8') }));
      child.stdin.end(input);
    });
  const withMock = async (fn: (env: Record<string, string>) => Promise<void>) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const sys: string = JSON.parse(body).system;
        const out = /pre-fill/.test(sys)
          ? { answers: { name: 'Coach Finder', summary: 'Helps new members find a coach and book a first session.', kind: 'mobile-app', primaryUsers: 'Busy parents who joined last month', goals: ['Book a first session in under 2 minutes'], nonGoals: ['Payments'] }, notes: ['Platforms not stated.'] }
          : /tighten/.test(sys)
            ? { rewrites: [{ id: 'primaryUsers', value: 'Busy parents booking care on their phone', why: 'One person.' }] }
            : /ONE short follow-up/.test(sys)
              ? { question: 'Which parents, and when?' }
              : { value: 'Working parents booking in the evening on their phone' };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 500, output_tokens: 50 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      await fn({ ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` });
    } finally {
      server.close();
    }
  };
  const quickInput = (users: string) => ['Demo', 'A small tool that helps teams write better briefs.', '1', '2', '', users, '', 'Writes a brief in under 5 minutes', '', 'Generate', '', '', '6'];

  it('--from drafts answers offline, as defaults to confirm', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'the-lowdown-from-'));
    writeFileSync(join(cwd, 'PRD.md'), PRD);
    const r = await run(['--from', 'PRD.md', '--quick', '-o', 'b.md', '-y'], cwd, '', { THE_LOWDOWN_NO_AI: '1' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Drafted \d answers from PRD\.md \(without AI\)/);
    assert.match(r.out, /Enter for: Coach Finder/);
    const md = r.file('b.md');
    assert.match(md, /# Design brief: Coach Finder/);
    assert.match(md, /- Book a first session in under 2 minutes/);
  });

  it('--from drafts answers with AI when it is available', () => withMock(async (env) => {
    const cwd = mkdtempSync(join(tmpdir(), 'the-lowdown-from-ai-'));
    writeFileSync(join(cwd, 'PRD.md'), PRD);
    const r = await run(['--from', 'PRD.md', '--quick', '-o', 'b.md', '-y'], cwd, '', env);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Drafted 6 answers from PRD\.md\. /);
    assert.match(r.out, /• Platforms not stated\./);
    assert.match(r.out, /AI: under \$0\.01 of the \$0\.25 budget via the API/);
    assert.match(r.file('b.md'), /\*\*Type:\*\* Mobile app/);
  }));

  it('falls back to offline when the AI fails', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'the-lowdown-from-fail-'));
    writeFileSync(join(cwd, 'PRD.md'), PRD);
    const r = await run(['--from', 'PRD.md', '--quick', '-o', 'b.md', '-y'], cwd, '', { ANTHROPIC_API_KEY: 'x', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /AI unavailable: .*Carrying on without it/);
    assert.match(r.out, /\(without AI\)/);
  });

  it('asks a follow-up for a vague answer', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'the-lowdown-fu-'));
    const input = quickInput('Everyone');
    input.splice(6, 0, 'Clinic front-desk staff on a shared desktop'); // the follow-up reply
    const r = await run(['--quick', '--follow-ups', '--no-ai', '-o', 'b.md', '-y'], cwd, input.join('\n'));
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /↳ Who would use it first\?/);
    assert.match(r.file('b.md'), /\*\*Primary user:\*\* Clinic front-desk staff on a shared desktop/);
  });

  it('tailors the follow-up with AI', () => withMock(async (env) => {
    const cwd = mkdtempSync(join(tmpdir(), 'the-lowdown-fu-ai-'));
    const input = quickInput('Parents');
    input.splice(6, 0, 'working ones, evenings');
    const r = await run(['--quick', '--follow-ups', '-o', 'b.md', '-y'], cwd, input.join('\n'), env);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /↳ Which parents, and when\?/);
    assert.match(r.file('b.md'), /\*\*Primary user:\*\* Working parents booking in the evening on their phone/);
  }));

  it('--suggest offers rewrites in the review and applies the accepted ones', () => withMock(async (env) => {
    const cwd = mkdtempSync(join(tmpdir(), 'the-lowdown-suggest-'));
    const r = await run(['--quick', '--suggest', '-o', 'b.md', '-y'], cwd, [...quickInput('Everyone'), 'y'].join('\n'), env);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /- Everyone\n\s+\+ Busy parents booking care on their phone/);
    assert.match(r.file('b.md'), /\*\*Primary user:\*\* Busy parents booking care on their phone/);
  }));

  it('lint --suggest prints rewrites, and says when AI is off', () => withMock(async (env) => {
    const cwd = mkdtempSync(join(tmpdir(), 'the-lowdown-lint-ai-'));
    writeFileSync(join(cwd, 'a.json'), JSON.stringify({ ...answers, primaryUsers: 'Everyone' }));
    let r = await run(['lint', 'a.json', '--suggest'], cwd, '', env);
    assert.match(r.out, /Suggested rewrites[\s\S]*\+ Busy parents booking care on their phone/);
    r = await run(['lint', 'a.json', '--suggest', '--no-ai'], cwd, '', env);
    assert.match(r.out, /need AI: set ANTHROPIC_API_KEY/);
  }));
});
