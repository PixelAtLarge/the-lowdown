import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { isEmpty, normalizeAnswer, validateAnswer } from './answers.js';
import { buildBrief } from './brief.js';
import { checkPrompt } from './check.js';
import { diffBriefs, type BriefChange } from './diff.js';
import { lintBrief } from './lint.js';
import { changedFiles, findCurbCut, loadProject, readBriefFile, runCurbCut, type Project } from './project.js';
import { renderBrief } from './render.js';
import { scoreBrief, scoreTips } from './score.js';
import { questionsToJSON } from './serialize.js';
import type { Answers, AnswerValue, Brief, Question } from './types.js';

/**
 * A Model Context Protocol server over stdio, so any MCP client (Claude Code,
 * Claude Desktop, Cursor…) can read, update and check against the brief.
 * Hand-rolled JSON-RPC: no dependencies.
 */

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  'the-lowdown keeps a design brief (BRIEF.md) for this project: users, goals, constraints and tone. ' +
  'Read it with get_brief before design work. To write or change it, interview the user with get_questions (one question at a time; never invent answers), then save with update_brief. ' +
  'Before calling design work done, run check_against_brief and work through every item.';

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
}

const pathProp = { type: 'string', description: 'Brief file, relative to the project. Default BRIEF.md.' };

export const TOOLS: ToolDef[] = [
  {
    name: 'get_brief',
    title: 'Get the design brief',
    description: 'Read the project\'s design brief, with its brief check and strength score. Use before any design or UI work.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathProp,
        format: { type: 'string', enum: ['markdown', 'prompt', 'json'], description: 'markdown (default), prompt (compact XML tags) or json.' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_questions',
    title: 'Get the interview questions',
    description: 'The brief interview: questions, sections, choices and rules, with the team config applied. Ask the user one question at a time, then save with update_brief.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'update_brief',
    title: 'Create or update the design brief',
    description:
      'Save answers to the brief, keyed by question id (see get_questions). Merges with the existing brief; creates it when missing (the required questions must then be answered). ' +
      'Only save what the user said. Returns what changed and the brief check.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathProp,
        answers: { type: 'object', description: 'Answers keyed by question id. Lists as arrays, choices by value, confirm as true/false, scale as a number.', additionalProperties: true },
        remove: { type: 'array', items: { type: 'string' }, description: 'Question ids whose answers to clear.' },
      },
      required: ['answers'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'check_against_brief',
    title: 'Check work against the brief',
    description:
      'A checklist for reviewing finished work against the brief: definition of done, must-avoid, out of scope and tone. Answer each item pass, fail or unsure with evidence, and fix the fails. ' +
      'Pass a preview URL to add accessibility findings from curb-cut when it is installed.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathProp,
        base: { type: 'string', description: 'Git ref to list changed files against. Default HEAD.' },
        url: { type: 'string', description: 'Preview URL for an automated accessibility and usability review (needs curb-cut).' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

type Content = { type: 'text'; text: string };
interface ToolResult {
  content: Content[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

const text = (t: string, extra: Partial<ToolResult> = {}): ToolResult => ({ content: [{ type: 'text', text: t }], ...extra });
const fail = (t: string): ToolResult => text(t, { isError: true });

function reviewText(brief: Brief): string {
  const issues = lintBrief(brief);
  const s = scoreBrief(brief, issues);
  const lines = [`Brief strength: ${s.score}/100 (${s.grade})`];
  for (const i of issues) lines.push(`- ${i.level === 'warn' ? 'warn' : 'tip'}: ${i.message} (${i.field})`);
  const tips = scoreTips(s);
  if (tips.length) lines.push(`To raise the score: ${tips.join(' ')}`);
  return lines.join('\n');
}

function changesText(changes: BriefChange[]): string {
  if (!changes.length) return 'No changes.';
  return changes
    .map((c) =>
      c.kind === 'list'
        ? `${c.label}:${c.added.map((x) => ` +${JSON.stringify(x)}`).join('')}${c.removed.map((x) => ` -${JSON.stringify(x)}`).join('')}${c.reordered ? ' (reordered)' : ''}`
        : `${c.label}: ${c.before === undefined ? '' : `${JSON.stringify(c.before)} → `}${c.after === undefined ? '(removed)' : JSON.stringify(c.after)}`,
    )
    .join('\n');
}

export interface McpOptions {
  cwd?: string;
  config?: string;
  version?: string;
}

export function createMcpHandler(opts: McpOptions = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const project = (): Project => loadProject(opts.config, cwd);

  /** Keep reads and writes inside the project, and to brief-shaped files. */
  const briefPath = (p: unknown): string => {
    const rel = typeof p === 'string' && p.trim() ? p.trim() : 'BRIEF.md';
    const abs = resolve(cwd, rel);
    const inside = relative(cwd, abs);
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error(`${rel} is outside the project.`);
    if (!['.md', '.markdown', '.json'].includes(extname(abs).toLowerCase())) throw new Error(`${rel}: use a .md or .json file.`);
    return abs;
  };

  async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const p = project();
    if (name === 'get_questions') {
      const q = questionsToJSON(p.questions, p.sections);
      return text(JSON.stringify(q, null, 2), { structuredContent: q as unknown as Record<string, unknown> });
    }

    if (name === 'get_brief') {
      const file = briefPath(args.path);
      if (!existsSync(file)) return fail(`No brief at ${relative(cwd, file)} yet. Interview the user with get_questions, then save with update_brief.`);
      const { brief } = readBriefFile(file, p);
      const format = args.format === 'json' || args.format === 'prompt' ? args.format : 'markdown';
      return text(`${renderBrief(brief, format)}\n---\n${reviewText(brief)}`);
    }

    if (name === 'update_brief') {
      const file = briefPath(args.path);
      const incoming = args.answers;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return fail('answers must be an object keyed by question id.');
      const existing = existsSync(file) ? readBriefFile(file, p) : undefined;
      const answers: Answers = { ...p.answers, ...(existing?.answers ?? {}) };
      const problems: string[] = [];
      for (const [id, raw] of Object.entries(incoming as Record<string, unknown>)) {
        const q: Question | undefined = p.questions.find((x) => x.id === id);
        if (!q) { problems.push(`${id}: no such question (see get_questions).`); continue; }
        if (raw === null || raw === undefined || raw === '') { delete answers[id]; continue; }
        if (typeof raw === 'object' && !Array.isArray(raw)) { problems.push(`${id}: expected a string, number, boolean or array.`); continue; }
        const value = normalizeAnswer(q, (Array.isArray(raw) ? raw.map(String) : raw) as AnswerValue, answers);
        const ok = validateAnswer(q, value, answers);
        if (ok !== true) problems.push(`${id}: ${ok}`);
        else if (isEmpty(value)) delete answers[id];
        else answers[id] = value;
      }
      for (const id of Array.isArray(args.remove) ? args.remove : []) if (typeof id === 'string') delete answers[id];
      if (problems.length) return fail(`Nothing saved.\n${problems.join('\n')}`);
      let brief: Brief;
      try {
        brief = buildBrief(answers, { questions: p.questions, toneGuidance: { ...p.toneGuidance, ...(existing?.toneGuidance ?? {}) }, now: existing?.brief.createdAt ? new Date(existing.brief.createdAt) : undefined });
      } catch (e) {
        return fail(`Nothing saved. ${(e as Error).message.replace(/\.+$/, '')}. Ask the user for those, then call update_brief again.`);
      }
      const isJson = extname(file).toLowerCase() === '.json';
      const content = isJson
        ? existing?.source === 'brief-json' ? renderBrief(brief, 'json') : JSON.stringify(answers, null, 2) + '\n'
        : renderBrief(brief, 'markdown', { sections: p.sections, frontmatter: true });
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
      const changes = existing ? diffBriefs(existing.brief, brief) : [];
      return text(`${existing ? 'Updated' : 'Created'} ${relative(cwd, file)}.\n\nChanges:\n${existing ? changesText(changes) : '(new brief)'}\n\n${reviewText(brief)}`);
    }

    if (name === 'check_against_brief') {
      const file = briefPath(args.path);
      if (!existsSync(file)) return fail(`No brief at ${relative(cwd, file)}. Write one first (get_questions, update_brief).`);
      const { brief } = readBriefFile(file, p);
      let findings;
      let findingsSource;
      let note = '';
      if (typeof args.url === 'string' && args.url) {
        const bin = findCurbCut(cwd);
        if (!bin) note = '\n\n(Install @pixelatlarge/curb-cut to add an automated accessibility review of the preview.)';
        else {
          try {
            const r = await runCurbCut(bin, args.url, { cwd });
            findings = r.findings;
            findingsSource = r.source;
          } catch (e) {
            note = `\n\n(curb-cut didn't finish: ${(e as Error).message})`;
          }
        }
      }
      const prompt = checkPrompt(brief, {
        briefPath: relative(cwd, file),
        changedFiles: changedFiles(typeof args.base === 'string' && args.base ? args.base : 'HEAD', cwd),
        findings,
        findingsSource,
      });
      return text(prompt + note);
    }

    return fail(`Unknown tool ${name}.`);
  }

  /** Handle one JSON-RPC message. Returns the response, or undefined for notifications. */
  return async function handle(msg: { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }) {
    const { id, method, params = {} } = msg;
    const isRequest = id !== undefined && id !== null;
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const error = (code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
    if (!method) return isRequest ? error(-32600, 'Invalid request') : undefined;
    if (!isRequest) return undefined; // notifications/initialized, cancelled…

    switch (method) {
      case 'initialize': {
        const asked = String(params.protocolVersion ?? '');
        return reply({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'the-lowdown', title: 'the-lowdown design brief', version: opts.version ?? '0.0.0' },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const name = String(params.name ?? '');
        if (!TOOLS.some((t) => t.name === name)) return error(-32602, `Unknown tool: ${name}`);
        try {
          return reply(await call(name, (params.arguments ?? {}) as Record<string, unknown>));
        } catch (e) {
          return reply(fail((e as Error).message));
        }
      }
      case 'resources/list':
        return reply({ resources: [] });
      case 'prompts/list':
        return reply({ prompts: [] });
      default:
        return error(-32601, `Method not found: ${method}`);
    }
  };
}

/** Serve MCP over stdin/stdout, one JSON-RPC message per line. Logs go to stderr only. */
export function serveMcp(opts: McpOptions = {}): Promise<void> {
  const handle = createMcpHandler(opts);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const write = (m: unknown) => process.stdout.write(JSON.stringify(m) + '\n');
  let pending = Promise.resolve();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    pending = pending.then(async () => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      const batch = Array.isArray(msg) ? msg : [msg];
      const out = (await Promise.all(batch.map((m) => handle(m)))).filter(Boolean);
      if (out.length) write(Array.isArray(msg) ? out : out[0]);
    });
  });
  return new Promise((done) => rl.on('close', () => pending.then(done)));
}
