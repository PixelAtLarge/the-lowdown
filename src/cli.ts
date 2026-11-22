#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { createInterface, emitKeypressEvents, type Interface } from 'node:readline';
import { parseArgs } from 'node:util';
import { rankItems, scaleRange } from './answers.js';
import { buildBrief, isBrief } from './brief.js';
import { applyConfig, validateConfig, type LowdownConfig } from './config.js';
import { linkBrief, parseLinkTargets, type LinkResult } from './link.js';
import { lintBrief } from './lint.js';
import { createMenu, menuReducer, renderMenu, type MenuItem, type MenuKey, type MenuResult, type MenuState } from './menu.js';
import { renderBrief, type RenderOptions } from './render.js';
import { questionsToJSON } from './serialize.js';
import { BriefSession } from './session.js';
import type { AnswerValue, Answers, Brief, LintIssue, OutputFormat, Question, Section } from './types.js';

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
  the-lowdown render <file>        Render an answers or brief JSON file
  the-lowdown lint <file>          Check a brief for weak spots
  the-lowdown questions            Print the question schema as JSON (for agents)
  the-lowdown link [brief]         Point CLAUDE.md / AGENTS.md / Cursor rules at a brief

${bold('Options')}
  -o, --out <file>          Output file. Default: BRIEF.md for init, stdout for render. "-" = stdout
  -f, --format <fmt>        markdown | prompt | json  (default: from --out extension, else markdown)
  -q, --quick               Essential questions only
      --answers <file>      Prefill answers from JSON; only missing questions are asked
      --config <file>       Team config (default: .lowdownrc.json, .lowdownrc or lowdown.config.json if present)
      --plain               Type numbers instead of using arrow-key menus
      --save-answers <file> Also save your raw answers as JSON (re-render or edit later)
      --no-instructions     Leave out the "How to use this brief" section
      --no-checklist        Leave out the definition-of-done checklist
      --link                After writing, point your agent instruction files at the brief
      --link-to <list>      Which files to link: claude, agents, cursor, copilot (comma-separated).
                            Default: whichever already exist, or AGENTS.md if none do
  -y, --yes                 Don't ask before writing or overwriting
  -h, --help                Show this help
  -v, --version             Show version

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
  if (f) throw new Error(`Unknown format "${explicit}". Use markdown, prompt or json.`);
  const ext = out && out !== '-' ? extname(out).toLowerCase() : '';
  if (ext === '.json') return 'json';
  if (ext === '.xml' || ext === '.txt' || ext === '.prompt') return 'prompt';
  return 'markdown';
}

function readJSON(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Could not read ${path}: ${(e as Error).message}`);
  }
}

function loadBrief(path: string, questions?: Question[]): Brief {
  const data = readJSON(path);
  if (isBrief(data)) return data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return buildBrief(data as Answers, { questions });
  }
  throw new Error(`${path} is neither a brief nor an answers object.`);
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

async function interview(session: BriefSession, reader: LineReader, menus: boolean): Promise<boolean> {
  let lastSection = '';
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
      else say(`${cyan('›')} ${showChosen(q, session.answers[q.id])}`);
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
      continue;
    }
    if (q.type === 'list') {
      raw = (await askList(reader, raw)) ?? raw;
    }
    const result = session.answerText(raw);
    if (!result.ok) say(red(`  ${result.error}`));
  }
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
}

const CONFIG_FILES = ['.lowdownrc.json', '.lowdownrc', 'lowdown.config.json'];

interface Loaded {
  config: LowdownConfig;
  file?: string;
  questions: Question[];
  sections: Section[];
  answers: Answers;
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

function renderOpts(flags: Flags, sections?: Section[]): RenderOptions {
  return { instructions: !flags['no-instructions'], checklist: !flags['no-checklist'], sections };
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
  const session = new BriefSession({ questions: loaded.questions, sections: loaded.sections, quick: flags.quick, answers: prefill });
  const reader = new LineReader();
  const menus = reader.terminal && !flags.plain && typeof process.stdin.setRawMode === 'function';

  try {
    say(bold('the-lowdown') + dim(' · a few minutes now saves a lot of agent rework'));
    say(dim('Enter skips optional questions · "<" goes back · "?" explains · Ctrl+C quits'));
    if (loaded.file) say(dim(`Using ${loaded.file}`));

    const done = await interview(session, reader, menus);
    if (!done) {
      const missing = session.missingRequired().map((q) => q.id).join(', ');
      throw new Error(`Input ended before the required questions were answered (${missing}).`);
    }

    const brief = session.toBrief();
    const issues = lintBrief(brief);
    say();
    say(bold('Review'));
    printIssues(issues);
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

    emit(renderBrief(brief, format, renderOpts(flags, session.sections)), out);
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
  const brief = loadBrief(file, loaded.questions);
  emit(renderBrief(brief, formatFor(flags.out, flags.format), renderOpts(flags, loaded.sections)), flags.out);
  if (flags.out && flags.out !== '-') {
    say(green(`✓ Wrote ${flags.out}`));
    if (wantsLink(flags)) runLink(flags.out, flags);
  } else if (wantsLink(flags)) {
    throw new Error('--link needs a brief file: add -o BRIEF.md (or another path).');
  }
}

function runLint(file: string | undefined, flags: Flags): number {
  if (!file) throw new Error('Usage: the-lowdown lint <answers-or-brief.json>');
  const issues = lintBrief(loadBrief(file, loadConfig(flags).questions));
  printIssues(issues);
  return issues.some((i) => i.level === 'warn') ? 1 : 0;
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

  const [command = 'init', arg] = positionals;
  const flags = values as Flags;
  switch (command) {
    case 'init':
      await runInit(flags);
      return 0;
    case 'render':
      runRender(arg, flags);
      return 0;
    case 'lint':
      return runLint(arg, flags);
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
