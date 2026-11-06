export type {
  AnswerValue,
  Answers,
  Brief,
  BuiltInSection,
  Choice,
  ExtraField,
  LintIssue,
  LintLevel,
  OutputFormat,
  Question,
  QuestionType,
  Section,
  SectionId,
} from './types.js';

export {
  ACCESSIBILITY_CHOICES,
  DEFAULT_QUESTIONS,
  SECTIONS,
  TONE_GUIDANCE,
  TONE_TENSIONS,
} from './questions.js';
export { isEmpty, normalizeAnswer, parseInput, validateAnswer } from './answers.js';
export { BriefSession, type AnswerResult, type SessionOptions } from './session.js';
export { buildBrief, isBrief, type BuildOptions } from './brief.js';
export { lintBrief } from './lint.js';
export {
  AGENT_INSTRUCTIONS,
  FIDELITY_GUIDANCE,
  renderBrief,
  toJSON,
  toMarkdown,
  toPrompt,
  type RenderOptions,
} from './render.js';
export { questionsToJSON, type SerializedQuestion } from './serialize.js';

import { buildBrief, type BuildOptions } from './brief.js';
import { renderBrief, type RenderOptions } from './render.js';
import type { Answers, OutputFormat } from './types.js';

/** One call: answers in, rendered brief out. */
export function createBrief(
  answers: Answers,
  opts: BuildOptions & RenderOptions & { format?: OutputFormat } = {},
): string {
  return renderBrief(buildBrief(answers, opts), opts.format ?? 'markdown', opts);
}
