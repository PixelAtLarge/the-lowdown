/** Built-in section ids. Custom questions may use any string. */
export type BuiltInSection = 'project' | 'users' | 'goals' | 'constraints' | 'tone';
export type SectionId = BuiltInSection | (string & {});

export type QuestionType =
  | 'text' // single line
  | 'longtext' // a sentence or two
  | 'list' // several short items
  | 'select' // pick one
  | 'multiselect' // pick several
  | 'confirm'; // yes / no

export type AnswerValue = string | string[] | boolean;
export type Answers = Record<string, AnswerValue>;

export interface Choice {
  value: string;
  label: string;
  hint?: string;
}

export interface Question {
  id: string;
  section: SectionId;
  prompt: string;
  type: QuestionType;
  /** One line explaining why this matters to the agent. */
  help?: string;
  /** A sample answer, shown as a placeholder. */
  example?: string;
  choices?: Choice[];
  /** For select / multiselect: accept answers that are not in `choices`. */
  allowOther?: boolean;
  /** For multiselect: maximum number of picks. */
  max?: number;
  required?: boolean;
  /** Included when running in quick mode. Required questions are always included. */
  quick?: boolean;
  default?: AnswerValue;
  /** Only ask when this returns true. */
  when?: (answers: Answers) => boolean;
  /** Return an error message, or true when valid. Runs after built-in checks. */
  validate?: (value: AnswerValue, answers: Answers) => string | true;
}

export interface Section {
  id: SectionId;
  title: string;
  /** Shown to the person answering. */
  intro?: string;
}

/** An answer to a question that isn't part of the built-in brief shape. */
export interface ExtraField {
  section: SectionId;
  id: string;
  label: string;
  value: AnswerValue;
}

export interface Brief {
  schemaVersion: 1;
  createdAt: string;
  project: {
    name: string;
    summary: string;
    kind?: string;
    fidelity?: string;
  };
  users: {
    primary: string;
    context?: string;
    accessibility: string[];
  };
  goals: {
    successCriteria: string[];
    primaryAction?: string;
    nonGoals: string[];
  };
  constraints: {
    platforms: string[];
    stack?: string;
    mustInclude: string[];
    mustAvoid: string[];
  };
  tone: {
    traits: string[];
    references: string[];
    avoid?: string;
  };
  /** Answers to custom questions, rendered under their section. */
  extra: ExtraField[];
}

export type LintLevel = 'warn' | 'info';

export interface LintIssue {
  level: LintLevel;
  field: string;
  message: string;
}

export type OutputFormat = 'markdown' | 'json' | 'prompt';
