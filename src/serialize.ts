import { DEFAULT_QUESTIONS, SECTIONS } from './questions.js';
import type { AnswerValue, Choice, Question, QuestionType, Section } from './types.js';

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
  required: boolean;
  quick: boolean;
  default?: AnswerValue;
  conditional: boolean;
}

export const INTERVIEW_INSTRUCTIONS = [
  'You are running a short the-lowdown interview with a person.',
  'Ask one question at a time, in order, using the prompt wording. Show the example as a hint and list choices when present.',
  'Required questions must be answered; the person may skip any other question.',
  'Accept natural answers and map them to choice values where they clearly match; keep anything else verbatim when allowOther is true.',
  'For list questions, collect several short items. For multiselect, respect max.',
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
      required: Boolean(q.required),
      quick: Boolean(q.required || q.quick),
      default: q.default,
      conditional: Boolean(q.when),
    })),
  };
}
