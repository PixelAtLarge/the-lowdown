import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import type { Finding } from './check.js';
import { applyConfig, validateConfig, type LowdownConfig } from './config.js';
import { readBrief, type ReadResult } from './read.js';
import type { Answers, Question, Section, ToneGuidance } from './types.js';

/** Node-side helpers shared by the CLI and the MCP server. */

export const CONFIG_FILES = ['.lowdownrc.json', '.lowdownrc', 'lowdown.config.json'];

export interface Project {
  config: LowdownConfig;
  file?: string;
  questions: Question[];
  sections: Section[];
  answers: Answers;
  toneGuidance: Record<string, ToneGuidance>;
}

export function readJSON(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Could not read ${path}: ${(e as Error).message}`);
  }
}

/** The team config (if any) applied to the questions. */
export function loadProject(configPath?: string, cwd = process.cwd()): Project {
  if (configPath && !existsSync(resolve(cwd, configPath))) throw new Error(`Config file ${configPath} not found.`);
  const file = configPath ?? CONFIG_FILES.find((f) => existsSync(resolve(cwd, f)));
  const config = (file ? readJSON(resolve(cwd, file)) : {}) as LowdownConfig;
  const errors = validateConfig(config);
  if (errors.length) throw new Error(`${file}:\n  ${errors.join('\n  ')}`);
  return { config, file, ...applyConfig(config) };
}

export function readBriefFile(path: string, project: Pick<Project, 'questions' | 'toneGuidance'>): ReadResult {
  if (!existsSync(path)) throw new Error(`${path} not found.`);
  try {
    return readBrief(readFileSync(path, 'utf8'), { questions: project.questions, toneGuidance: project.toneGuidance });
  } catch (e) {
    throw new Error(`Could not read ${path}: ${(e as Error).message}`);
  }
}

/** True when the file exists and reads as a brief (Markdown, brief JSON or answers JSON). */
export function isBriefFile(path: string, project: Pick<Project, 'questions' | 'toneGuidance'>): boolean {
  try {
    readBriefFile(path, project);
    return true;
  } catch {
    return false;
  }
}

/** Files changed since a git ref (committed, staged and unstaged), plus untracked files. Empty outside a repo. */
export function changedFiles(base = 'HEAD', cwd = process.cwd()): string[] {
  const git = (args: string[]) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : [];
  };
  return [...new Set([...git(['diff', '--name-only', base]), ...git(['ls-files', '--others', '--exclude-standard'])])];
}

/** The curb-cut CLI, if it's installed in this project or on the PATH. */
export function findCurbCut(cwd = process.cwd()): string | undefined {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  const dirs = [join(cwd, 'node_modules', '.bin'), ...(process.env.PATH ?? '').split(delimiter)];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = join(dir, `curb-cut${ext}`);
      try {
        if (dir && statSync(p).isFile()) return p;
      } catch { /* not here */ }
    }
  }
  return undefined;
}

export interface CurbCutRun {
  findings: Finding[];
  failed: boolean;
  source: string;
}

/** Run `curb-cut review` on a preview URL and read back its findings. */
export function runCurbCut(bin: string, url: string, opts: { pages?: string[]; cwd?: string } = {}): Promise<CurbCutRun> {
  const out = mkdtempSync(join(tmpdir(), 'the-lowdown-curb-cut-'));
  const args = ['review', '--url', url, '--out', out, ...(opts.pages ?? []).flatMap((p) => ['--page', p])];
  return new Promise((done, fail) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', fail);
    child.on('close', (code) => {
      const report = join(out, 'report.json');
      if (!existsSync(report)) return fail(new Error(`curb-cut exited ${code}: ${err.trim().split('\n').pop() ?? 'no report'}`));
      const r = readJSON(report) as { failed?: boolean; pages?: Array<{ page?: string; issues?: Array<{ severity?: string; title?: string; fix?: string; isNew?: boolean }> }> };
      const findings: Finding[] = [];
      const seen = new Set<string>();
      for (const p of r.pages ?? []) {
        for (const i of p.issues ?? []) {
          if (i.isNew === false) continue;
          const key = `${i.title}|${p.page}`;
          if (seen.has(key)) continue;
          seen.add(key);
          findings.push({ severity: i.severity ?? 'issue', title: i.title ?? 'Untitled issue', page: p.page, fix: i.fix });
        }
      }
      const rank = ['critical', 'serious', 'moderate', 'minor'];
      findings.sort((a, b) => (rank.indexOf(a.severity) + 9) % 9 - (rank.indexOf(b.severity) + 9) % 9);
      done({ findings, failed: Boolean(r.failed), source: `curb-cut on ${url}` });
    });
  });
}
