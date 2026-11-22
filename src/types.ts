/** Built-in section ids. Custom questions may use any string. */
export type BuiltInSection = 'project' | 'users' | 'goals' | 'constraints' | 'tone';
export type SectionId = BuiltInSection | (string & {});

export type QuestionType =
  | 'text' // single line
  | 'longtext' // a sentence or two
  | 'list' // several short items
  | 'select' // pick one
  | 'multiselect' // pick several
  | 'confirm' // yes / no
  | 'scale' // a number between min and max
  | 'rank'; // put items in priority order

export type AnswerValue = string | string[] | boolean | number;

/**
 * Declarative condition: ask only when every listed answer matches. A value
 * matches if it equals the answer (case-insensitive), or, for list answers, is
 * included in it. An array of values means "any of these". "*" means "answered
 * at all". For yes/no questions use true or false.
 */
export type Condition = Record<string, AnswerValue | AnswerValue[]>;
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
  /** For multiselect: maximum number of picks. For scale: the top of the range. */
  max?: number;
  /** For scale: the bottom of the range (default 1). */
  min?: number;
  /** For scale: what the ends of the range mean, e.g. "Spacious" and "Dense". */
  minLabel?: string;
  maxLabel?: string;
  /** For rank: rank the items of another (list) answer instead of fixed choices. */
  rankFrom?: string;
  required?: boolean;
  /** Included when running in quick mode. Required questions are always included. */
  quick?: boolean;
  default?: AnswerValue;
  /** Only ask when this returns true. */
  when?: (answers: Answers) => boolean;
  /** Only ask when these answers match. Serializable, so it also works in config files. */
  condition?: Condition;
  /** Return an error message, or true when valid. Runs after built-in checks. */
  validate?: (value: AnswerValue, answers: Answers) => string | true;
}

export interface Section {
  id: SectionId;
  title: string;
  /** Shown to the person answering. */
  intro?: string;
}

/** A product or brand that captures the feel, and what to take from it. */
export interface Reference {
  name: string;
  borrow?: string;
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
    secondary?: string[];
    accessibility: string[];
  };
  goals: {
    /** In priority order when `ranked` is true: the first wins a conflict. */
    successCriteria: string[];
    ranked?: boolean;
    primaryAction?: string;
    nonGoals: string[];
  };
  constraints: {
    platforms: string[];
    stack?: string;
    /** 'real' | 'some' | 'none': how much real content exists. */
    content?: string;
    brandAssets?: string[];
    /** Requirements that apply everywhere: dark mode, localization… */
    crossCutting?: string[];
    mustInclude: string[];
    mustAvoid: string[];
  };
  tone: {
    traits: string[];
    /** "Product — what to borrow" strings; see parseReference(). */
    references: string[];
    avoid?: string;
  };
  /** Answers to the questions for this kind of project (landing page, dashboard…). */
  specifics?: ExtraField[];
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
