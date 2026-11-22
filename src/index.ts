export type {
  AnswerValue,
  Answers,
  Brief,
  BuiltInSection,
  Choice,
  Condition,
  ExtraField,
  LintIssue,
  LintLevel,
  OutputFormat,
  Question,
  QuestionType,
  Reference,
  Section,
  SectionId,
} from './types.js';

export {
  ACCESSIBILITY_CHOICES,
  DEFAULT_QUESTIONS,
  SECTIONS,
  TONE_GUIDANCE,
  TONE_TENSIONS,
  projectLabel,
} from './questions.js';
export {
  isApplicable,
  isEmpty,
  matchesCondition,
  normalizeAnswer,
  parseInput,
  rankItems,
  scaleRange,
  validateAnswer,
} from './answers.js';
export { applyConfig, validateConfig, type ConfigQuestion, type LowdownConfig, type QuestionOverride } from './config.js';
export { BriefSession, type AnswerResult, type SessionOptions } from './session.js';
export { buildBrief, isBrief, parseReference, type BuildOptions } from './brief.js';
export { lintBrief } from './lint.js';
export {
  AGENT_INSTRUCTIONS,
  CONTENT_GUIDANCE,
  FIDELITY_GUIDANCE,
  renderBrief,
  toJSON,
  toMarkdown,
  toPrompt,
  type RenderOptions,
} from './render.js';
export { questionsToJSON, type SerializedQuestion } from './serialize.js';
export { answersFromHash, decodeAnswers, encodeAnswers, shareUrl } from './share.js';
// linkBrief() writes files, so it lives at '@pixelatlarge/the-lowdown/link' to keep this entry browser-safe.

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
