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
  ToneGuidance,
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
export { lintBrief, questionForField } from './lint.js';
export { checklist, checkPrompt, type CheckGroup, type CheckItem, type CheckOptions, type Finding } from './check.js';
export { SKILL_MD, SKILL_NAME } from './skill.js';
export { followUpFor, type FollowUp } from './followups.js';
export { draftFromText, htmlToText } from './draft.js';
export {
  BudgetError,
  coerceAnswer,
  createAssistant,
  costOf,
  estimateCost,
  DEFAULT_MODELS,
  PRICES,
  type Assistant,
  type AssistantOptions,
  type AssistStage,
  type Complete,
  type CompleteRequest,
  type CompleteResult,
  type Draft,
  type Rewrite,
} from './assist.js';
export { scoreBrief, scoreTips, type BriefScore, type ScorePart } from './score.js';
export { diffBriefs, type BriefChange } from './diff.js';
export { readBrief, type ReadOptions, type ReadResult } from './read.js';
export { isMarkdownBrief, markdownToHtml, parseMarkdownBrief, stripFrontmatter, type ParsedMarkdownBrief } from './markdown.js';
export {
  AGENT_INSTRUCTIONS,
  CONTENT_GUIDANCE,
  definitionOfDone,
  FIDELITY_GUIDANCE,
  renderBrief,
  toHTML,
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
