import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  questionsToJSON,
  renderBrief,
  type Answers,
  type Question,
} from './index.js';

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
    const s = new BriefSession({ answers: { name: 'x', summary: 'y', kind: 'web-app', fidelity: 'sketch', primaryUsers: 'z', userContext: 'c' } });
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
