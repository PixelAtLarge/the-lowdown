import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, extname, join } from 'node:path';
import { costOf, type Complete, type CompleteResult } from './assist.js';
import { htmlToText } from './draft.js';

export { BudgetError, createAssistant, DEFAULT_MODELS, PRICES, type Assistant, type AssistantOptions, type Complete, type Rewrite } from './assist.js';

/**
 * Strip whitespace from Claude credentials. A token pasted into a CI secret often
 * picks up a line break, which makes every request fail as "credentials missing".
 */
export function tidyCredentials(env: NodeJS.ProcessEnv = process.env): void {
  for (const k of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] as const) {
    const v = env[k];
    if (v === undefined) continue;
    const clean = v.replace(/\s+/g, '');
    if (clean) env[k] = clean;
    else delete env[k];
  }
}

export function authHint(): string {
  return 'Claude credentials are missing or expired. Set ANTHROPIC_API_KEY, or open Claude Code (`claude`) and run /login.';
}

/** Call the Claude Messages API directly with an API key. Uses fetch, so there is nothing to install. */
export function anthropicApi(opts: { apiKey?: string; baseUrl?: string; fetch?: typeof fetch } = {}): Complete {
  return async (req) => {
    tidyCredentials();
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error(authHint());
    const base = (opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    const res = await (opts.fetch ?? fetch)(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: req.model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: 'user', content: req.user }] }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
      error?: { message?: string };
    };
    if (!res.ok) {
      const msg = body.error?.message ?? `HTTP ${res.status}`;
      throw new Error(res.status === 401 || res.status === 403 ? `${authHint()} (${msg})` : `Claude request failed: ${msg}`);
    }
    const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    const u = body.usage ?? {};
    const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    return { text, costUsd: costOf(req.model, input, u.output_tokens ?? 0) };
  };
}

const AUTH_ERROR = /^(?:API Error: 40[13]|Failed to authenticate|Invalid API key|Please run \/login|OAuth (?:session|token)|Not logged in|Credit balance is too low|Your organization)/i;

/**
 * Reuse an existing Claude Code login by running `claude -p` as a plain
 * completion: no tools, no MCP servers, none of the person's settings or
 * CLAUDE.md files, nothing saved to their session history.
 */
export function claudeCode(opts: { bin?: string } = {}): Complete {
  return (req) =>
    new Promise<CompleteResult>((resolve, reject) => {
      tidyCredentials();
      const args = [
        '-p', '--output-format', 'json',
        '--model', req.model,
        '--system-prompt', req.system,
        '--tools', '',
        '--setting-sources', '',
        '--strict-mcp-config',
        '--no-session-persistence',
      ];
      if (req.maxCostUsd) args.push('--max-budget-usd', req.maxCostUsd.toFixed(2));
      const child = spawn(opts.bin ?? 'claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let errText = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (errText += d));
      child.on('error', (e: NodeJS.ErrnoException) =>
        reject(new Error(e.code === 'ENOENT' ? `Claude Code isn't installed. ${authHint()}` : e.message)),
      );
      child.on('close', (code) => {
        const line = out.trim().split('\n').filter(Boolean).pop() ?? '';
        let res: { result?: string; is_error?: boolean; total_cost_usd?: number; subtype?: string } | undefined;
        try {
          res = JSON.parse(line);
        } catch {
          return reject(new Error(`Claude Code failed${code ? ` (exit ${code})` : ''}: ${(errText || out).trim().split('\n')[0] || 'no output'}`));
        }
        const text = typeof res?.result === 'string' ? res.result : '';
        if (res?.is_error || !text) {
          const why = text || res?.subtype || errText.trim().split('\n')[0] || 'no reply';
          return reject(new Error(AUTH_ERROR.test(why) || /login|credential|auth/i.test(why) ? `${authHint()} (${why})` : `Claude request failed: ${why}`));
        }
        if (text.length < 400 && AUTH_ERROR.test(text)) return reject(new Error(`${authHint()} (${text})`));
        resolve({ text, costUsd: typeof res?.total_cost_usd === "number" ? res.total_cost_usd : undefined });
      });
      child.stdin.end(req.user);
    });
}

function onPath(bin: string): boolean {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD').split(';') : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const ext of exts) {
      try {
        if (dir && statSync(join(dir, bin + ext)).isFile()) return true;
      } catch { /* not here */ }
    }
  }
  return false;
}

export type AiRoute = 'api' | 'claude-code';

/** Which route would be used, without any network call. API key first, then a Claude Code install. */
export function detectAi(): AiRoute | undefined {
  tidyCredentials();
  if (process.env.ANTHROPIC_API_KEY) return 'api';
  if (onPath('claude')) return 'claude-code';
  return undefined;
}

/** True when a Claude Code login looks present (a cheap file check; the call itself is the real test). */
export function hasClaudeLogin(): boolean {
  const home = homedir();
  return Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN) || existsSync(join(home, '.claude', '.credentials.json')) || existsSync(join(home, '.claude.json'));
}

/** The best available route as a Complete function, or undefined when there's none. */
export function autoComplete(): Complete | undefined {
  const route = detectAi();
  if (route === 'api') return anthropicApi();
  if (route === 'claude-code') return claudeCode();
  return undefined;
}

/** Read a PRD, README or page for --from: a local file or an http(s) URL. HTML becomes plain text. */
export async function readSource(input: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (/^https?:\/\//i.test(input)) {
    const res = await fetcher(input, { headers: { accept: 'text/html, text/markdown, text/plain;q=0.9, */*;q=0.5' } });
    if (!res.ok) throw new Error(`Couldn't read ${input}: HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (/pdf/i.test(type)) throw new Error(`${input} is a PDF. Save it as text or Markdown first.`);
    const body = await res.text();
    return /html/i.test(type) || /^\s*<(!doctype|html)/i.test(body) ? htmlToText(body) : body;
  }
  if (!existsSync(input)) throw new Error(`${input} not found.`);
  const ext = extname(input).toLowerCase();
  if (ext === '.pdf' || ext === '.docx') throw new Error(`${input}: save it as text or Markdown first (${ext} isn't supported).`);
  const text = readFileSync(input, 'utf8');
  return ext === '.html' || ext === '.htm' ? htmlToText(text) : text;
}
