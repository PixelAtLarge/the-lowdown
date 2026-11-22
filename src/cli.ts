#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { createInterface, emitKeypressEvents, type Interface } from 'node:readline';
import { parseArgs } from 'node:util';
import { rankItems, scaleRange } from './answers.js';
import { BudgetError, coerceAnswer, createAssistant, type Assistant, type Rewrite } from './assist.js';
import { autoComplete, detectAi, readSource, type AiRoute } from './ai.js';
import { draftFromText } from './draft.js';
import { followUpFor } from './followups.js';
import { diffBriefs, type BriefChange } from './diff.js';
import { readBrief, type ReadResult } from './read.js';
import { scoreBrief, scoreTips } from './score.js';
import { applyConfig, validateConfig, type LowdownConfig } from './config.js';
import { linkBrief, parseLinkTargets, type LinkResult } from './link.js';
import { lintBrief, questionForField } from './lint.js';
import { createMenu, menuReducer, renderMenu, type MenuItem, type MenuKey, type MenuResult, type MenuState } from './menu.js';
import { renderBrief, type RenderOptions } from './render.js';
import { questionsToJSON } from './serialize.js';
import { BriefSession } from './session.js';
import type { AnswerValue, Answers, Brief, LintIssue, OutputFormat, Question, Section, ToneGuidance } from './types.js';

// ── Terminal helpers ─────────────────────────────────────────

const err = process.stderr;
const useColor = Boolean(err.isTTY) && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1');
const dim = paint('2');
const cyan = paint('36');
const green = paint('32');
const yellow = paint('33');
const red = paint('31');
const say = (s = '') => err.write(s + '\n');

class LineReader {
  private rl!: Interface;
  private suspended = false;
  private readonly queue: string[] = [];
  private readonly waiters: Array<(line: string | null) => void> = [];
  private closed = false;
  readonly terminal: boolean;

  constructor() {
    this.terminal = Boolean(process.stdin.isTTY && err.isTTY);
    this.open();
  }

  private open() {
    this.rl = createInterface({ input: process.stdin, output: err, terminal: this.terminal });
    this.rl.on('line', (line) => {
      const w = this.waiters.shift();
      if (w) w(line);
      else this.queue.push(line);
    });
    this.rl.on('close', () => {
      if (this.suspended) return;
      this.closed = true;
      for (const w of this.waiters.splice(0)) w(null);
    });
    this.rl.on('SIGINT', () => {
      say('\n' + dim('Cancelled. Nothing was written.'));
      process.exit(130);
    });
  }

  /** Resolves with the next line, or null when input has ended. */
  ask(prompt: string): Promise<string | null> {
    if (this.terminal) {
      this.rl.setPrompt(prompt);
      this.rl.prompt();
    } else {
      err.write(prompt);
    }
    const queued = this.queue.shift();
    if (queued !== undefined) {
      if (!this.terminal) err.write(queued + '\n');
      return Promise.resolve(queued);
    }
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) =>
      this.waiters.push((line) => {
        if (!this.terminal && line !== null) err.write(line + '\n');
        resolve(line);
      }),
    );
  }

  /** Hand stdin to a raw-mode menu, then take it back. */
  async withRawInput<T>(fn: () => Promise<T>): Promise<T> {
    this.suspended = true;
    this.rl.close();
    try {
      return await fn();
    } finally {
      this.suspended = false;
      this.open();
    }
  }

  close() {
    this.rl.close();
  }
}

// ── Arrow-key menus (TTY only) ───────────────────────────────

/** Translate a keypress into a menu key. */
function toMenuKey(str: string | undefined, key: { name?: string; ctrl?: boolean } = {}): MenuKey | 'cancel' | undefined {
  if (key.ctrl && key.name === 'c') return 'cancel';
  if (str === '<') return { name: 'back' };
  if (str === '?') return { name: 'help' };
  if (str && /^[1-9]$/.test(str)) return { name: 'digit', digit: Number(str) };
  const map: Record<string, MenuKey> = {
    up: { name: 'up' }, k: { name: 'up' }, down: { name: 'down' }, j: { name: 'down' },
    space: { name: 'space' }, return: { name: 'enter' }, enter: { name: 'enter' },
    home: { name: 'home' }, end: { name: 'end' }, left: { name: 'back' }, escape: { name: 'back' },
  };
  return key.name ? map[key.name] : undefined;
}

async function runMenu(reader: LineReader, initial: MenuState): Promise<MenuResult> {
  return reader.withRawInput(
    () =>
      new Promise<MenuResult>((resolve) => {
        emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        err.write('\x1b[?25l'); // hide cursor
        let state = initial;
        let drawn = 0;
        let finished = false;
        const draw = () => {
          if (drawn) err.write(`\x1b[${drawn}A\x1b[0J`);
          const lines = renderMenu(state, { dim, cyan, bold });
          err.write(lines.join('\n') + '\n');
          drawn = lines.length;
        };
        const cleanup = () => {
          process.stdin.off('keypress', onKey);
          err.write('\x1b[?25h');
          process.stdin.setRawMode(false);
          process.stdin.pause();
        };
        // One listener for the whole menu, so keys that arrive together (held
        // arrows, fast typing, pasted digits) are all handled in order.
        const onKey = (str: string | undefined, key?: { name?: string; ctrl?: boolean }) => {
          if (finished) return;
          const k = toMenuKey(str, key);
          if (!k) return;
          if (k === 'cancel') {
            cleanup();
            say('\n' + dim('Cancelled. Nothing was written.'));
            process.exit(130);
          }
          const { state: next, result } = menuReducer(state, k);
          state = next;
          if (result) {
            finished = true;
            err.write(`\x1b[${drawn}A\x1b[0J`);
            cleanup();
            resolve(result);
            return;
          }
          draw();
        };
        process.stdin.on('keypress', onKey);
        draw();
      }),
  );
}

// ── Arg parsing ──────────────────────────────────────────────

const HELP = `${bold('the-lowdown')} — give your AI agent the lowdown. A short guided Q&A that writes a design brief it can follow.

${bold('Usage')}
  the-lowdown [init] [options]     Run the guided Q&A (default)
  the-lowdown edit [file]          Reopen a brief (default BRIEF.md) with its answers as defaults
  the-lowdown diff <old> <new>     Show what changed between two briefs (exit 1 if they differ)
  the-lowdown render <file>        Render a brief (Markdown or JSON) or an answers file
  the-lowdown lint <file>          Check a brief for weak spots and score it
  the-lowdown questions            Print the question schema as JSON (for agents)
  the-lowdown link [brief]         Point CLAUDE.md / AGENTS.md / Cursor rules at a brief

${bold('Options')}
  -o, --out <file>          Output file. Default: BRIEF.md for init, stdout for render. "-" = stdout
  -f, --format <fmt>        markdown | prompt | json | html  (default: from --out extension, else markdown)
  -q, --quick               Essential questions only
      --answers <file>      Prefill answers from JSON; only missing questions are asked
      --config <file>       Team config (default: .lowdownrc.json, .lowdownrc or lowdown.config.json if present)
      --plain               Type numbers instead of using arrow-key menus
      --save-answers <file> Also save your raw answers as JSON (re-render or edit later)
      --no-instructions     Leave out the "How to use this brief" section
      --no-checklist        Leave out the definition-of-done checklist
      --no-frontmatter      Leave out the small front matter block at the top of BRIEF.md
      --only <list>         edit: only re-ask these sections or question ids (e.g. tone,goals)
      --from <file|url>     Draft answers from a PRD, README or web page; you confirm each one
      --suggest             Suggest sharper answers for what the review flags (lint: print them)
      --no-follow-ups       Don't ask a follow-up when an answer is vague (on in a terminal)
      --no-ai               Don't use AI, even when it's available
      --model <id>          Claude model for every AI step
      --budget <usd>        AI spend cap for this run (default 0.25)
      --link                After writing, point your agent instruction files at the brief
      --link-to <list>      Which files to link: claude, agents, cursor, copilot (comma-separated).
                            Default: whichever already exist, or AGENTS.md if none do
  -y, --yes                 Don't ask before writing or overwriting
  -h, --help                Show this help
  -v, --version             Show version

${bold('AI (optional)')}
  --from, --suggest and tailored follow-ups use Claude when ANTHROPIC_API_KEY is set or
  Claude Code is installed and logged in. Without it, --from and follow-ups still work offline.

${bold('While answering')}
  Enter   skip an optional question (or accept the default)
  <       go back one question
  ?       show why the question matters
  Menus   ↑↓ to move, space to pick, enter to confirm (or type the numbers with --plain)
`;

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return String(pkg.version);
  } catch {
    return 'unknown';
  }
}

function formatFor(out: string | undefined, explicit: string | undefined): OutputFormat {
  const f = explicit?.toLowerCase();
  if (f === 'md' || f === 'markdown') return 'markdown';
  if (f === 'json') return 'json';
  if (f === 'prompt' || f === 'xml') return 'prompt';
  if (f === 'html' || f === 'pdf') return 'html';
  if (f) throw new Error(`Unknown format "${explicit}". Use markdown, prompt, json or html.`);
  const ext = out && out !== '-' ? extname(out).toLowerCase() : '';
  if (ext === '.json') return 'json';
  if (ext === '.xml' || ext === '.txt' || ext === '.prompt') return 'prompt';
  if (ext === '.html' || ext === '.htm') return 'html';
  return 'markdown';
}

function readJSON(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Could not read ${path}: ${(e as Error).message}`);
  }
}

function readBriefFile(path: string, loaded: { questions: Question[]; toneGuidance: Record<string, ToneGuidance> }): ReadResult {
  if (!existsSync(path)) throw new Error(`${path} not found.`);
  try {
    return readBrief(readFileSync(path, 'utf8'), { questions: loaded.questions, toneGuidance: loaded.toneGuidance });
  } catch (e) {
    throw new Error(`Could not read ${path}: ${(e as Error).message}`);
  }
}

function printScore(brief: Brief, issues: LintIssue[]) {
  const s = scoreBrief(brief, issues);
  const color = s.score >= 70 ? green : s.score >= 45 ? yellow : red;
  say(`${bold('Brief strength:')} ${color(`${s.score}/100 · ${s.grade}`)}`);
  for (const t of scoreTips(s)) say(dim(`  + ${t}`));
}

function printChanges(changes: BriefChange[]) {
  for (const c of changes) {
    say(bold(c.label) + (c.kind === 'list' && c.reordered ? dim('  (reordered)') : ''));
    if (c.kind === 'list') {
      c.removed.forEach((x) => say(red(`  - ${x}`)));
      c.added.forEach((x) => say(green(`  + ${x}`)));
    } else {
      if (c.before !== undefined) say(red(`  - ${c.before}`));
      if (c.after !== undefined) say(green(`  + ${c.after}`));
    }
  }
}

function printIssues(issues: LintIssue[]) {
  if (!issues.length) {
    say(green('✓ No issues. This brief gives an agent plenty to work with.'));
    return;
  }
  for (const i of issues) {
    const tag = i.level === 'warn' ? yellow('warn') : cyan('tip ');
    say(`  ${tag}  ${i.message} ${dim(`(${i.field})`)}`);
  }
}

// ── Interactive interview ────────────────────────────────────

function describeScale(q: Question): string[] {
  const { min, max } = scaleRange(q);
  const ends = q.minLabel && q.maxLabel ? `${min} = ${q.minLabel}, ${max} = ${q.maxLabel}` : `${min} to ${max}`;
  return [dim(`  A number from ${min} to ${max} (${ends})`)];
}

function describeRank(items: string[]): string[] {
  return [
    ...items.map((item, i) => `  ${dim(String(i + 1).padStart(2) + '.')} ${item}`),
    dim(`  Numbers in priority order, most important first (e.g. ${items.map((_, i) => i + 1).reverse().join(',')})`),
  ];
}

function menuFor(q: Question, answers: Answers, initial: AnswerValue | undefined): MenuState | undefined {
  const asList = (v: AnswerValue | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [String(v)]);
  if (q.type === 'select' || q.type === 'multiselect') {
    if (!q.choices?.length) return undefined;
    return createMenu({
      mode: q.type === 'select' ? 'single' : 'multi',
      items: q.choices,
      picked: asList(initial),
      max: q.max,
      allowOther: q.allowOther,
      optional: !q.required,
    });
  }
  if (q.type === 'scale') {
    const { min, max } = scaleRange(q);
    const items: MenuItem[] = [];
    for (let n = min; n <= max; n++) {
      items.push({ value: String(n), label: String(n), hint: n === min ? q.minLabel : n === max ? q.maxLabel : undefined });
    }
    return createMenu({ mode: 'single', items, picked: asList(initial), optional: !q.required });
  }
  if (q.type === 'rank') {
    const items = rankItems(q, answers).map((i) => ({ value: i, label: i }));
    return createMenu({ mode: 'order', items, picked: asList(initial), optional: !q.required });
  }
  return undefined;
}

function describeChoices(q: Question): string[] {
  const lines = (q.choices ?? []).map((c, i) => {
    const n = dim(String(i + 1).padStart(2) + '.');
    return `  ${n} ${c.label}${c.hint ? dim(` — ${c.hint}`) : ''}`;
  });
  if (q.type === 'multiselect') {
    const max = q.max ? `up to ${q.max}, ` : '';
    lines.push(dim(`  Numbers separated by commas (${max}e.g. 1,3)${q.allowOther ? ', or type your own' : ''}`));
  } else if (q.allowOther) {
    lines.push(dim('  A number, or type your own'));
  }
  return lines;
}

const showValue = (v: AnswerValue) =>
  typeof v === 'boolean' ? (v ? 'yes' : 'no') : Array.isArray(v) ? v.join(', ') : String(v);

/** An answer as the person saw it: choice labels, "4 of 5", ranked order. */
function showChosen(q: Question, v: AnswerValue | undefined): string {
  if (v === undefined) return dim('skipped');
  const label = (x: string) => q.choices?.find((c) => c.value === x)?.label ?? x;
  if (q.type === 'scale') return `${v} of ${scaleRange(q).max}`;
  if (q.type === 'rank' && Array.isArray(v)) return v.map((x, i) => `${i + 1}. ${x}`).join('  ');
  return Array.isArray(v) ? v.map(label).join(', ') : typeof v === 'string' ? label(v) : showValue(v);
}

async function askList(reader: LineReader, first: string): Promise<string | null> {
  const items = [first];
  for (;;) {
    const line = await reader.ask(dim('  + '));
    if (line === null || line.trim() === '') break;
    items.push(line);
  }
  return items.join('\n');
}

async function interview(session: BriefSession, reader: LineReader, menus: boolean, opts: InterviewOptions = {}): Promise<boolean> {
  let lastSection = '';
  const asked = new Set<string>();
  for (;;) {
    const q = session.current();
    if (!q) return true;

    if (q.section !== lastSection) {
      const s = session.sections.find((x) => x.id === q.section);
      say();
      say(cyan(bold(`── ${s?.title ?? q.section}`)) + (s?.intro ? dim(` · ${s.intro}`) : ''));
      lastSection = q.section;
    }

    const { index, total } = session.progress();
    const draft = session.draft(q.id);
    say();
    say(`${dim(`[${index}/${total}]`)} ${bold(q.prompt)}${q.required ? red(' *') : ''}`);
    const menu = menus ? menuFor(q, session.answers, draft ?? q.default) : undefined;
    if (menu) {
      if (q.example) say(dim(`  e.g. ${q.example}`));
      const result = await runMenu(reader, menu);
      if (result.action === 'back') {
        if (session.back()) lastSection = '';
        continue;
      }
      if (result.action === 'help') {
        say(dim(`  ${q.help ?? 'No extra help for this one.'}`));
        continue;
      }
      let outcome;
      if (result.action === 'skip') outcome = draft !== undefined ? session.answer(draft) : session.skip();
      else if (result.action === 'submit') outcome = session.answer(q.type === 'scale' ? Number(result.value) : result.value);
      else {
        const typed = await reader.ask(cyan('  Type your own: '));
        if (typed === null) continue;
        const value = q.type === 'multiselect' ? [...result.picked, ...typed.split(',')].join(',') : typed;
        outcome = session.answerText(value);
      }
      if (!outcome.ok) say(red(`  ${outcome.error}`));
      else {
        say(`${cyan('›')} ${showChosen(q, session.answers[q.id])}`);
        await maybeFollowUp(q, session, reader, opts, asked);
      }
      continue;
    }

    if (q.choices && q.type !== 'rank') describeChoices(q).forEach((l) => say(l));
    if (q.type === 'scale') describeScale(q).forEach((l) => say(l));
    if (q.type === 'rank') describeRank(rankItems(q, session.answers)).forEach((l) => say(l));
    if (q.type === 'list') say(dim('  One per line. Empty line when done.'));
    if (q.example) say(dim(`  e.g. ${q.example}`));
    if (draft !== undefined) say(dim(`  Enter to keep: ${showValue(draft)}`));
    else if (q.default !== undefined) say(dim(`  Enter for: ${showValue(q.default)}`));

    let raw = await reader.ask(cyan('› '));
    if (raw === null) {
      // Input ended (e.g. piped). Skip whatever is optional; fail on required.
      while (session.current()) {
        if (!session.skip().ok) return false;
      }
      return true;
    }
    const cmd = raw.trim();

    if (cmd === '<') {
      if (session.back() && lastSection) lastSection = '';
      continue;
    }
    if (cmd === '?') {
      say(dim(`  ${q.help ?? 'No extra help for this one.'}`));
      continue;
    }
    if (cmd === '') {
      const result = draft !== undefined ? session.answer(draft) : session.skip();
      if (!result.ok) say(red(`  ${result.error}`));
      else await maybeFollowUp(q, session, reader, opts, asked);
      continue;
    }
    if (q.type === 'list') {
      raw = (await askList(reader, raw)) ?? raw;
    }
    const result = session.answerText(raw);
    if (!result.ok) say(red(`  ${result.error}`));
    else await maybeFollowUp(q, session, reader, opts, asked);
  }
}

// ── AI (optional) ────────────────────────────────────────────

/** The AI side of one run. It switches itself off after the first failure, so the interview never stalls. */
class AiHelper {
  assistant?: Assistant;
  private warned = false;
  constructor(readonly route: AiRoute | undefined, assistant: Assistant | undefined) {
    this.assistant = assistant;
  }

  get on(): boolean {
    return Boolean(this.assistant);
  }

  /** Run an AI step; on any error, say so once and carry on without AI. */
  async try<T>(step: (a: Assistant) => Promise<T>): Promise<T | undefined> {
    if (!this.assistant) return undefined;
    try {
      return await step(this.assistant);
    } catch (e) {
      if (!this.warned) {
        const msg = (e as Error).message.split('\n')[0];
        say(yellow(`  ${e instanceof BudgetError ? msg : `AI unavailable: ${msg}`} Carrying on without it.`));
        this.warned = true;
      }
      if (!(e instanceof BudgetError)) this.assistant = undefined;
      return undefined;
    }
  }

  summary() {
    const a = this.assistant;
    if (!a || a.spent === 0) return;
    const how = this.route === 'claude-code' ? 'via Claude Code' : 'via the API';
    say(dim(`AI: ${a.spent < 0.01 ? 'under $0.01' : `about $${a.spent.toFixed(2)}`} of the $${a.budget.toFixed(2)} budget ${how}`));
  }
}

function makeAi(flags: Flags, config: LowdownConfig, questions: Question[]): AiHelper {
  if (flags['no-ai'] || config.ai === false || process.env.THE_LOWDOWN_NO_AI) return new AiHelper(undefined, undefined);
  const route = detectAi();
  const complete = route ? autoComplete() : undefined;
  if (!complete) return new AiHelper(undefined, undefined);
  const cfg = config.ai || {};
  const budget = flags.budget !== undefined ? Number(flags.budget) : cfg.budget;
  if (budget !== undefined && !(budget >= 0)) throw new Error('--budget must be a number of US dollars, e.g. 0.50.');
  const model = flags.model ?? process.env.THE_LOWDOWN_MODEL ?? cfg.model;
  return new AiHelper(route, createAssistant({ complete, questions, budget, model, models: flags.model ? undefined : cfg.models }));
}

interface InterviewOptions {
  followUps?: boolean;
  ai?: AiHelper;
}

/** Ask one more question when an answer is too vague, then fold the reply in. */
async function maybeFollowUp(q: Question, session: BriefSession, reader: LineReader, opts: InterviewOptions, asked: Set<string>) {
  if (!opts.followUps || asked.has(q.id)) return;
  const value = session.answers[q.id];
  const fu = followUpFor(q, value, session.answers);
  if (!fu || value === undefined) return;
  asked.add(q.id);
  const prompt = (await opts.ai?.try((a) => a.followUpQuestion(fu, value, session.answers))) ?? fu.prompt;
  say(`${yellow('  ↳')} ${bold(prompt)}`);
  if (fu.example) say(dim(`    e.g. ${fu.example}`));
  say(dim('    Enter keeps your answer.'));
  const reply = await reader.ask(cyan('  › '));
  if (reply === null || !reply.trim()) return;
  const merged = (await opts.ai?.try((a) => a.mergeFollowUp(fu, value, prompt, reply, session.answers))) ?? fu.merge(value, reply);
  const r = session.set(q.id, merged);
  if (r.ok) say(`${cyan('  ›')} ${showChosen(q, session.answers[q.id])}`);
  else say(red(`  ${r.error}`));
}

function showRewrite(r: Rewrite, q: Question | undefined) {
  say();
  say(bold(r.label));
  say(dim(`  ${r.issue}`));
  if (r.current !== undefined) say(red(`  - ${q ? showChosen(q, r.current) : showValue(r.current)}`));
  say(green(`  + ${q ? showChosen(q, r.suggestion) : showValue(r.suggestion)}`));
  if (r.why) say(dim(`  ${r.why}`));
}

/**
 * After the review: offer sharper answers for flagged items, one at a time.
 * Returns true when any were accepted. Asked only in a terminal, or with --suggest.
 */
async function offerRewrites(session: BriefSession, reader: LineReader, ai: AiHelper, issues: LintIssue[], force: boolean): Promise<boolean> {
  const fixable = issues.filter((i) => questionForField(i.field) && session.find(questionForField(i.field)!));
  if (!fixable.length) return false;
  if (!ai.on) {
    if (force) say(dim('  Suggested rewrites need AI: set ANTHROPIC_API_KEY, or install Claude Code and log in.'));
    return false;
  }
  if (!force) {
    if (!reader.terminal) return false;
    const a = await reader.ask(`Suggest sharper answers for ${fixable.length === 1 ? 'the flagged item' : `the ${fixable.length} flagged items`}? ${dim('(y/N)')} `);
    if (!a || !/^y/i.test(a.trim())) return false;
  }
  say(dim('  Asking Claude…'));
  const rewrites = (await ai.try((a) => a.suggestRewrites(session.toBrief(), session.answers, fixable))) ?? [];
  if (!rewrites.length) {
    say(dim('  No rewrites to suggest.'));
    return false;
  }
  let changed = false;
  for (const r of rewrites) {
    const q = session.find(r.questionId);
    showRewrite(r, q);
    const a = await reader.ask(`  Use it? ${dim('(y/N)')} `);
    if (a && /^y/i.test(a.trim())) {
      const res = session.set(r.questionId, r.suggestion);
      if (res.ok) changed = true;
      else say(red(`  ${res.error}`));
    }
  }
  return changed;
}

/** Review step shared by init and edit: issues, score, optional rewrites, then the review again if anything changed. */
async function review(session: BriefSession, reader: LineReader, ai: AiHelper, suggest: boolean, now?: Date): Promise<Brief> {
  let brief = session.toBrief(now);
  let issues = lintBrief(brief);
  say();
  say(bold('Review'));
  printIssues(issues);
  printScore(brief, issues);
  if (await offerRewrites(session, reader, ai, issues, suggest)) {
    brief = session.toBrief(now);
    issues = lintBrief(brief);
    say();
    say(bold('Review'));
    printIssues(issues);
    printScore(brief, issues);
  }
  return brief;
}

/** --from: draft answers from a document. AI when available, a simple offline read otherwise. */
async function draftFrom(source: string, questions: Question[], ai: AiHelper): Promise<Answers> {
  const text = await readSource(source);
  say(dim(`Reading ${source}…`));
  const viaAi = await ai.try((a) => a.draftAnswers(text, { source, questions }));
  let answers: Answers = {};
  if (viaAi) {
    answers = viaAi.answers;
  } else {
    for (const [id, v] of Object.entries(draftFromText(text))) {
      const q = questions.find((x) => x.id === id);
      const c = q ? coerceAnswer(q, v, answers) : undefined;
      if (c !== undefined) answers[id] = c;
    }
  }
  const n = Object.keys(answers).length;
  say(n
    ? green(`✓ Drafted ${n} ${n === 1 ? 'answer' : 'answers'} from ${source}${viaAi ? '' : ' (without AI)'}. Enter accepts each one; type to change it.`)
    : yellow(`  Couldn't find answers in ${source}${viaAi ? '' : ' without AI'}. Carrying on with the usual questions.`));
  for (const note of viaAi?.notes ?? []) say(dim(`  • ${note}`));
  return answers;
}

async function confirm(reader: LineReader, question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  const a = await reader.ask(`${question} ${dim('(Y/n)')} `);
  return a === null || !/^n/i.test(a.trim());
}

// ── Commands ─────────────────────────────────────────────────

interface Flags {
  out?: string;
  format?: string;
  quick?: boolean;
  answers?: string;
  'save-answers'?: string;
  'no-instructions'?: boolean;
  'no-checklist'?: boolean;
  yes?: boolean;
  link?: boolean;
  'link-to'?: string;
  config?: string;
  plain?: boolean;
  only?: string;
  'no-frontmatter'?: boolean;
  from?: string;
  suggest?: boolean;
  'no-follow-ups'?: boolean;
  'follow-ups'?: boolean;
  'no-ai'?: boolean;
  model?: string;
  budget?: string;
}

const CONFIG_FILES = ['.lowdownrc.json', '.lowdownrc', 'lowdown.config.json'];

interface Loaded {
  config: LowdownConfig;
  file?: string;
  questions: Question[];
  sections: Section[];
  answers: Answers;
  toneGuidance: Record<string, ToneGuidance>;
}

function loadConfig(flags: Flags): Loaded {
  const file = flags.config ?? CONFIG_FILES.find((f) => existsSync(f));
  if (flags.config && !existsSync(flags.config)) throw new Error(`Config file ${flags.config} not found.`);
  const config = (file ? readJSON(file) : {}) as LowdownConfig;
  const errors = validateConfig(config);
  if (errors.length) throw new Error(`${file}:\n  ${errors.join('\n  ')}`);
  return { config, file, ...applyConfig(config) };
}

/** Command-line flags win over the config file. */
function withConfig(flags: Flags, config: LowdownConfig): Flags {
  const link = config.link;
  return {
    ...flags,
    out: flags.out ?? config.out,
    format: flags.format ?? config.format,
    quick: flags.quick || config.quick,
    link: flags.link || link === true || Array.isArray(link),
    'link-to': flags['link-to'] ?? (Array.isArray(link) ? link.join(',') : undefined),
    'no-instructions': flags['no-instructions'] || config.instructions === false,
    'no-checklist': flags['no-checklist'] || config.checklist === false,
  };
}

const wantsLink = (flags: Flags) => Boolean(flags.link || flags['link-to']);

function runLink(brief: string, flags: Flags): LinkResult[] {
  const targets = flags['link-to'] ? parseLinkTargets(flags['link-to']) : undefined;
  const results = linkBrief({ brief, targets });
  for (const r of results) {
    const verb = { created: 'Created', added: 'Linked', updated: 'Updated', unchanged: 'Already linked:' }[r.action];
    say((r.action === 'unchanged' ? dim : green)(`✓ ${verb} ${r.file}`));
  }
  return results;
}

function renderOpts(flags: Flags, sections?: Section[], toFile = false): RenderOptions {
  return { instructions: !flags['no-instructions'], checklist: !flags['no-checklist'], sections, frontmatter: toFile && !flags['no-frontmatter'] };
}

function emit(content: string, out: string | undefined) {
  if (!out || out === '-') process.stdout.write(content);
  else writeFileSync(out, content);
}

async function runInit(rawFlags: Flags) {
  const loaded = loadConfig(rawFlags);
  const flags = withConfig(rawFlags, loaded.config);
  const out = flags.out ?? 'BRIEF.md';
  const format = formatFor(out, flags.format);
  if (flags['link-to']) parseLinkTargets(flags['link-to']); // fail before the interview, not after
  const prefill = { ...loaded.answers, ...(flags.answers ? (readJSON(flags.answers) as Answers) : {}) };
  const reader = new LineReader();
  const menus = reader.terminal && !flags.plain && typeof process.stdin.setRawMode === 'function';
  const ai = makeAi(rawFlags, loaded.config, loaded.questions);
  const followUps = !rawFlags['no-follow-ups'] && (Boolean(rawFlags['follow-ups']) || (loaded.config.followUps ?? reader.terminal));

  try {
    say(bold('the-lowdown') + dim(' · a few minutes now saves a lot of agent rework'));
    say(dim('Enter skips optional questions · "<" goes back · "?" explains · Ctrl+C quits'));
    if (loaded.file) say(dim(`Using ${loaded.file}`));

    // --from: drafted answers become defaults, so each one is shown and confirmed, never slipped in.
    let questions = loaded.questions;
    if (rawFlags.from) {
      const drafted = await draftFrom(rawFlags.from, loaded.questions, ai);
      questions = loaded.questions.map((q) => (drafted[q.id] !== undefined && prefill[q.id] === undefined ? { ...q, default: drafted[q.id] } : q));
    }
    const session = new BriefSession({ questions, sections: loaded.sections, quick: flags.quick, answers: prefill, toneGuidance: loaded.toneGuidance });

    const done = await interview(session, reader, menus, { followUps, ai });
    if (!done) {
      const missing = session.missingRequired().map((q) => q.id).join(', ');
      throw new Error(`Input ended before the required questions were answered (${missing}).`);
    }

    const brief = await review(session, reader, ai, Boolean(rawFlags.suggest));
    ai.summary();
    say();

    const target = out === '-' ? 'stdout' : out;
    if (!(await confirm(reader, `Write the brief to ${bold(target)}?`, Boolean(flags.yes)))) {
      say(dim('Nothing written.'));
      return;
    }
    if (out !== '-' && existsSync(out) && !(await confirm(reader, `${out} exists. Overwrite?`, Boolean(flags.yes)))) {
      say(dim('Nothing written.'));
      return;
    }

    emit(renderBrief(brief, format, renderOpts(flags, session.sections, out !== '-')), out);
    if (flags['save-answers']) {
      writeFileSync(flags['save-answers'], JSON.stringify(session.answers, null, 2) + '\n');
    }
    if (out !== '-') {
      say(green(`✓ Wrote ${out}`) + (flags['save-answers'] ? green(` and ${flags['save-answers']}`) : ''));
      if (wantsLink(flags)) runLink(out, flags);
      else say(dim(`  Point your agent at it: run "the-lowdown link" (or add --link next time).`));
    } else if (wantsLink(flags)) {
      say(yellow('  --link skipped: the brief went to stdout. Save it to a file, then run "the-lowdown link <file>".'));
    }
  } finally {
    reader.close();
  }
}

function runRender(file: string | undefined, rawFlags: Flags) {
  if (!file) throw new Error('Usage: the-lowdown render <answers-or-brief.json> [-o file] [-f format]');
  const loaded = loadConfig(rawFlags);
  const flags = { ...withConfig(rawFlags, loaded.config), out: rawFlags.out }; // render prints to stdout unless -o
  const { brief } = readBriefFile(file, loaded);
  const toFile = Boolean(flags.out && flags.out !== '-');
  emit(renderBrief(brief, formatFor(flags.out, flags.format), renderOpts(flags, loaded.sections, toFile)), flags.out);
  if (flags.out && flags.out !== '-') {
    say(green(`✓ Wrote ${flags.out}`));
    if (wantsLink(flags)) runLink(flags.out, flags);
  } else if (wantsLink(flags)) {
    throw new Error('--link needs a brief file: add -o BRIEF.md (or another path).');
  }
}

async function runLint(file: string | undefined, flags: Flags): Promise<number> {
  if (!file) throw new Error('Usage: the-lowdown lint <brief>');
  const loaded = loadConfig(flags);
  const { brief, answers } = readBriefFile(file, loaded);
  const issues = lintBrief(brief);
  printIssues(issues);
  printScore(brief, issues);
  if (flags.suggest) await printSuggestions(brief, answers, issues, makeAi(flags, loaded.config, loaded.questions), loaded.questions);
  return issues.some((i) => i.level === 'warn') ? 1 : 0;
}

async function printSuggestions(brief: Brief, answers: Answers, issues: LintIssue[], ai: AiHelper, questions: Question[]) {
  say();
  if (!ai.on) {
    say(dim('Suggested rewrites need AI: set ANTHROPIC_API_KEY, or install Claude Code and log in.'));
    return;
  }
  say(bold('Suggested rewrites'));
  const rewrites = (await ai.try((a) => a.suggestRewrites(brief, answers, issues))) ?? [];
  if (!rewrites.length) say(dim('  Nothing to suggest.'));
  for (const r of rewrites) showRewrite(r, questions.find((q) => q.id === r.questionId));
  say();
  say(dim('Apply them with "the-lowdown edit --suggest".'));
  ai.summary();
}

function runDiff(a: string | undefined, b: string | undefined, flags: Flags): number {
  if (!a || !b) throw new Error('Usage: the-lowdown diff <old brief> <new brief>');
  const loaded = loadConfig(flags);
  const changes = diffBriefs(readBriefFile(a, loaded).brief, readBriefFile(b, loaded).brief);
  if (!changes.length) {
    say(green('✓ No differences. Both briefs say the same thing.'));
    return 0;
  }
  printChanges(changes);
  say();
  say(dim(`${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`));
  return 1;
}

async function runEdit(file: string | undefined, rawFlags: Flags) {
  const loaded = loadConfig(rawFlags);
  const flags = withConfig(rawFlags, loaded.config);
  const source = file ?? 'BRIEF.md';
  const original = readBriefFile(source, loaded);
  const out = rawFlags.out ?? source;
  const format = original.source === 'markdown' || rawFlags.out ? formatFor(out, rawFlags.format) : 'json';
  if (flags['link-to']) parseLinkTargets(flags['link-to']);

  // --only: keep everything else as it is, re-ask just these sections or ids.
  const only = rawFlags.only?.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const reask = (q: Question) => !only || only.includes(q.id.toLowerCase()) || only.includes(q.section.toLowerCase());
  if (only) {
    const known = new Set(loaded.questions.flatMap((q) => [q.id.toLowerCase(), q.section.toLowerCase()]));
    const bad = only.filter((x) => !known.has(x));
    if (bad.length) throw new Error(`--only: no section or question called ${bad.join(', ')}.`);
  }
  const questions = loaded.questions.map((q): Question => {
    if (!reask(q)) return original.answers[q.id] === undefined ? { ...q, when: () => false } : q;
    return original.answers[q.id] !== undefined ? { ...q, default: original.answers[q.id] } : q;
  });
  const prefill = Object.fromEntries(Object.entries(original.answers).filter(([id]) => {
    const q = loaded.questions.find((x) => x.id === id);
    return !q || !reask(q);
  }));
  const toneGuidance = { ...loaded.toneGuidance, ...original.toneGuidance };
  const session = new BriefSession({ questions, sections: loaded.sections, quick: flags.quick, answers: prefill, toneGuidance });
  const reader = new LineReader();
  const menus = reader.terminal && !flags.plain && typeof process.stdin.setRawMode === 'function';
  const ai = makeAi(rawFlags, loaded.config, loaded.questions);
  const followUps = !rawFlags['no-follow-ups'] && (Boolean(rawFlags['follow-ups']) || (loaded.config.followUps ?? reader.terminal));

  try {
    say(bold('the-lowdown edit') + dim(` · ${source}`));
    say(dim('Enter keeps the current answer · "<" goes back · "?" explains · Ctrl+C quits'));
    const done = await interview(session, reader, menus, { followUps, ai });
    if (!done) throw new Error('Input ended before the required questions were answered.');

    const created = original.brief.createdAt ? new Date(original.brief.createdAt) : undefined;
    const reviewed = await review(session, reader, ai, Boolean(rawFlags.suggest), created);
    const brief = reviewed;
    const changes = diffBriefs(original.brief, brief);
    say();
    say(bold('Changes'));
    if (changes.length) printChanges(changes);
    else say(dim('  None.'));
    ai.summary();
    say();
    if (!changes.length && out === source) {
      say(dim('Nothing changed, so nothing was written.'));
      return;
    }
    if (!(await confirm(reader, `Write the brief to ${bold(out === '-' ? 'stdout' : out)}?`, Boolean(flags.yes)))) {
      say(dim('Nothing written.'));
      return;
    }
    const content = original.source === 'answers-json' && !rawFlags.out
      ? JSON.stringify(session.answers, null, 2) + '\n'
      : renderBrief(brief, format, renderOpts(flags, session.sections, out !== '-'));
    emit(content, out);
    if (out !== '-') {
      say(green(`✓ Wrote ${out}`));
      if (wantsLink(flags)) runLink(out, flags);
    }
  } finally {
    reader.close();
  }
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f' },
      quick: { type: 'boolean', short: 'q' },
      answers: { type: 'string' },
      'save-answers': { type: 'string' },
      'no-instructions': { type: 'boolean' },
      'no-checklist': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      link: { type: 'boolean' },
      'link-to': { type: 'string' },
      config: { type: 'string' },
      plain: { type: 'boolean' },
      only: { type: 'string' },
      'no-frontmatter': { type: 'boolean' },
      from: { type: 'string' },
      suggest: { type: 'boolean' },
      'follow-ups': { type: 'boolean' },
      'no-follow-ups': { type: 'boolean' },
      'no-ai': { type: 'boolean' },
      model: { type: 'string' },
      budget: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (values.version) {
    process.stdout.write(readVersion() + '\n');
    return 0;
  }

  const [command = 'init', arg, arg2] = positionals;
  const flags = values as Flags;
  switch (command) {
    case 'init':
      await runInit(flags);
      return 0;
    case 'render':
      runRender(arg, flags);
      return 0;
    case 'lint':
      return await runLint(arg, flags);
    case 'diff':
      return runDiff(arg, arg2, flags);
    case 'edit':
      await runEdit(arg, flags);
      return 0;
    case 'link': {
      const brief = arg ?? 'BRIEF.md';
      if (!existsSync(brief)) throw new Error(`${brief} not found. Run the-lowdown first, or pass the brief's path.`);
      runLink(brief, flags);
      return 0;
    }
    case 'questions': {
      const loaded = loadConfig(flags);
      emit(JSON.stringify(questionsToJSON(loaded.questions, loaded.sections), null, 2) + '\n', flags.out);
      return 0;
    }
    default:
      throw new Error(`Unknown command "${command}". Run the-lowdown --help.`);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: Error) => {
    say(red(`Error: ${e.message}`));
    process.exit(1);
  },
);
