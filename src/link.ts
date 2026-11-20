import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Agent instruction files the brief can be linked from. */
export type LinkTarget = 'claude' | 'agents' | 'cursor' | 'copilot';

export const LINK_TARGETS: Record<LinkTarget, string> = {
  claude: 'CLAUDE.md',
  agents: 'AGENTS.md',
  cursor: '.cursor/rules/the-lowdown.mdc',
  copilot: '.github/copilot-instructions.md',
};

export interface LinkResult {
  target: LinkTarget;
  /** Path relative to the project root. */
  file: string;
  action: 'created' | 'added' | 'updated' | 'unchanged';
}

export interface LinkOptions {
  /** Path to the brief. Default: BRIEF.md in the project root. */
  brief?: string;
  /** Which files to link. Default: the ones that already exist, or AGENTS.md if none do. */
  targets?: LinkTarget[];
  /** Project root. Default: process.cwd(). */
  cwd?: string;
  /** Report what would change without writing anything. */
  dryRun?: boolean;
}

const START = '<!-- the-lowdown:start -->';
const END = '<!-- the-lowdown:end -->';
const BLOCK = new RegExp(`${START}[\\s\\S]*?${END}`);

const toPosix = (p: string) => p.split(sep).join('/');

/** The instruction an agent reads, pointing at the brief. */
export function linkInstruction(briefPath = 'BRIEF.md'): string {
  return (
    `Follow ${briefPath} for all design decisions. ` +
    'Treat its "Must" items as hard requirements and its "Out of scope" list as do-not-build. ' +
    'When it is silent, choose what best serves its primary user and primary action, and list your assumptions.'
  );
}

/** The marked block written into instruction files. Re-linking replaces it in place. */
export function linkBlock(briefPath = 'BRIEF.md'): string {
  return `${START}\n## Design brief\n\n${linkInstruction(briefPath)}\n${END}`;
}

function cursorRule(briefPath: string): string {
  return [
    '---',
    'description: Design brief written by the-lowdown. Follow it for all UI and design decisions.',
    'alwaysApply: true',
    '---',
    '',
    linkBlock(briefPath),
    '',
    `@${briefPath}`,
    '',
  ].join('\n');
}

/** Instruction files that already exist in the project. */
export function detectLinkTargets(cwd: string = process.cwd()): LinkTarget[] {
  const found: LinkTarget[] = [];
  if (existsSync(join(cwd, LINK_TARGETS.claude))) found.push('claude');
  if (existsSync(join(cwd, LINK_TARGETS.agents))) found.push('agents');
  const cursorDir = join(cwd, '.cursor');
  if (existsSync(cursorDir) && statSync(cursorDir).isDirectory()) found.push('cursor');
  if (existsSync(join(cwd, LINK_TARGETS.copilot))) found.push('copilot');
  return found;
}

/** Parse "claude,cursor" into targets; throws on unknown names. */
export function parseLinkTargets(list: string): LinkTarget[] {
  const names = list.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = names.filter((n) => !(n in LINK_TARGETS));
  if (bad.length) {
    throw new Error(`Unknown link target "${bad.join(', ')}". Use: ${Object.keys(LINK_TARGETS).join(', ')}.`);
  }
  return [...new Set(names)] as LinkTarget[];
}

/**
 * Point agent instruction files (CLAUDE.md, AGENTS.md, Cursor rules, Copilot
 * instructions) at the brief. Idempotent: an existing the-lowdown block is
 * replaced in place, anything else in the file is left alone.
 */
export function linkBrief(opts: LinkOptions = {}): LinkResult[] {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const briefPath = toPosix(relative(cwd, resolve(cwd, opts.brief ?? 'BRIEF.md'))) || 'BRIEF.md';
  const detected = detectLinkTargets(cwd);
  const targets = opts.targets?.length ? opts.targets : detected.length ? detected : (['agents'] as LinkTarget[]);

  return targets.map((target): LinkResult => {
    const file = LINK_TARGETS[target];
    const abs = join(cwd, file);
    const block = linkBlock(briefPath);

    if (target === 'cursor') {
      // The rule file is ours alone, so it is rewritten whole.
      const next = cursorRule(briefPath);
      const prev = existsSync(abs) ? readFileSync(abs, 'utf8') : undefined;
      const action = prev === undefined ? 'created' : prev === next ? 'unchanged' : 'updated';
      if (!opts.dryRun && action !== 'unchanged') {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, next);
      }
      return { target, file, action };
    }

    if (!existsSync(abs)) {
      const heading = target === 'claude' ? '# CLAUDE.md' : target === 'agents' ? '# AGENTS.md' : '# Copilot instructions';
      if (!opts.dryRun) {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, `${heading}\n\n${block}\n`);
      }
      return { target, file, action: 'created' };
    }

    const prev = readFileSync(abs, 'utf8');
    let next: string;
    let action: LinkResult['action'];
    if (BLOCK.test(prev)) {
      next = prev.replace(BLOCK, block);
      action = next === prev ? 'unchanged' : 'updated';
    } else {
      const body = prev.replace(/\s*$/, '');
      next = body ? `${body}\n\n${block}\n` : `${block}\n`;
      action = 'added';
    }
    if (!opts.dryRun && action !== 'unchanged') writeFileSync(abs, next);
    return { target, file, action };
  });
}
