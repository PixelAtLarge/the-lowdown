import { DEFAULT_QUESTIONS, SECTIONS } from './questions.js';
import type { AnswerValue, Choice, Condition, Question, QuestionType, Section } from './types.js';

export interface SerializedQuestion {
  id: string;
  section: string;
  prompt: string;
  type: QuestionType;
  help?: string;
  example?: string;
  choices?: Choice[];
  allowOther?: boolean;
  max?: number;
  min?: number;
  minLabel?: string;
  maxLabel?: string;
  rankFrom?: string;
  /** Ask only when these answers match (see Condition). */
  condition?: Condition;
  required: boolean;
  quick: boolean;
  default?: AnswerValue;
  /** True when the question is only asked in some situations. */
  conditional: boolean;
}

export const INTERVIEW_INSTRUCTIONS = [
  'You are running a short the-lowdown interview with a person.',
  'Ask one question at a time, in order, using the prompt wording. Show the example as a hint and list choices when present.',
  'Required questions must be answered; the person may skip any other question.',
  'Accept natural answers and map them to choice values where they clearly match; keep anything else verbatim when allowOther is true.',
  'For list questions, collect several short items. For multiselect, respect max. For scale, ask for a whole number between min and max. For rank, ask the person to order the items (from rankFrom answer or choices) most important first.',
  'Skip a question whose condition does not match the answers so far; a goals ranking only applies when there are two or more goals.',
  'Do not invent answers. When finished, write the answers as a JSON object keyed by question id and render it with `the-lowdown render <file>`.',
].join(' ');

/** Plain-JSON question schema (functions stripped), e.g. for an agent to run the interview. */
export function questionsToJSON(
  questions: Question[] = DEFAULT_QUESTIONS,
  sections: Section[] = SECTIONS,
): { instructions: string; sections: Section[]; questions: SerializedQuestion[] } {
  return {
    instructions: INTERVIEW_INSTRUCTIONS,
    sections,
    questions: questions.map((q) => ({
      id: q.id,
      section: q.section,
      prompt: q.prompt,
      type: q.type,
      help: q.help,
      example: q.example,
      choices: q.choices,
      allowOther: q.allowOther,
      max: q.max,
      min: q.min,
      minLabel: q.minLabel,
      maxLabel: q.maxLabel,
      rankFrom: q.rankFrom,
      condition: q.condition,
      required: Boolean(q.required),
      quick: Boolean(q.required || q.quick),
      default: q.default,
      conditional: Boolean(q.when || q.condition),
    })),
  };
}
