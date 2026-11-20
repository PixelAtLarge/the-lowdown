import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { isEmpty } from './answers.js';
import { lintBrief } from './lint.js';
import { renderBrief, type RenderOptions } from './render.js';
import { BriefSession } from './session.js';
import type { AnswerValue, Answers, Brief, LintIssue, OutputFormat, Question } from './types.js';

export interface UseBriefSessionOptions {
  questions?: Question[];
  quick?: boolean;
  initialAnswers?: Answers;
}

/** React state around a headless BriefSession. Re-renders on every step. */
export function useBriefSession(opts: UseBriefSessionOptions = {}) {
  const ref = useRef<BriefSession>();
  if (!ref.current) ref.current = new BriefSession({ questions: opts.questions, quick: opts.quick, answers: opts.initialAnswers });
  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);
  const session = ref.current;

  return {
    session,
    current: session.current(),
    progress: session.progress(),
    answers: session.answers,
    isComplete: session.isComplete,
    answer: (value: AnswerValue) => { const r = session.answer(value); bump(); return r; },
    answerText: (raw: string) => { const r = session.answerText(raw); bump(); return r; },
    skip: () => { const r = session.skip(); bump(); return r; },
    back: () => { const q = session.back(); bump(); return q; },
    reset: (answers?: Answers) => {
      ref.current = new BriefSession({ questions: opts.questions, quick: opts.quick, answers });
      bump();
    },
  };
}

const FILE_NAMES: Record<OutputFormat, string> = { markdown: 'BRIEF.md', prompt: 'brief-prompt.txt', json: 'brief.json' };
const FORMAT_LABELS: Record<OutputFormat, string> = { markdown: 'Markdown', prompt: 'Prompt', json: 'JSON' };

export interface ResultContext {
  brief: Brief;
  answers: Answers;
  format: OutputFormat;
  output: string;
}

export interface LowdownFormProps {
  /** Defaults to the built-in questions. */
  questions?: Question[];
  /** Ask only the essential questions. */
  quick?: boolean;
  /** Pre-filled answers; those questions are skipped. */
  initialAnswers?: Answers;
  /** Open on the finished brief when initialAnswers already cover the required questions (e.g. a shared link). */
  startAtResult?: boolean;
  /** Called after every answer. */
  onChange?: (answers: Answers) => void;
  /** Called when the brief is created. */
  onComplete?: (brief: Brief, answers: Answers) => void;
  /** Output tabs on the result screen. */
  formats?: OutputFormat[];
  renderOptions?: RenderOptions;
  /** Extra buttons on the result screen, e.g. a share link. */
  resultActions?: (ctx: ResultContext) => ReactNode;
  className?: string;
}

type Stage = 'questions' | 'review' | 'result';

/**
 * A drop-in interview: one question at a time, a review step that flags weak
 * answers, then the brief with copy and download. Unstyled apart from `ld-`
 * class names; import '@pixelatlarge/the-lowdown/react/styles.css' for the default theme.
 */
export function LowdownForm(props: LowdownFormProps) {
  const { formats = ['markdown', 'prompt', 'json'], renderOptions, onChange, onComplete, resultActions } = props;
  const s = useBriefSession({ questions: props.questions, quick: props.quick, initialAnswers: props.initialAnswers });
  const canStartAtResult = props.startAtResult && s.session.missingRequired().length === 0;
  const [stage, setStage] = useState<Stage>(canStartAtResult ? 'result' : 'questions');
  const [format, setFormat] = useState<OutputFormat>(formats[0] ?? 'markdown');
  const [error, setError] = useState<string>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (stage === 'questions' && s.isComplete) setStage('review');
  }, [stage, s.isComplete]);

  const qid = s.current?.id;
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [qid, stage]);

  const brief = useMemo(
    () => (stage === 'questions' ? undefined : s.session.missingRequired().length ? undefined : s.session.toBrief()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stage, JSON.stringify(s.answers)],
  );
  const issues: LintIssue[] = useMemo(() => (brief ? lintBrief(brief) : []), [brief]);

  const submit = (value: AnswerValue | undefined) => {
    const r = value === undefined || isEmpty(value) ? s.skip() : s.answer(value);
    if (!r.ok) { setError(r.error); return; }
    setError(undefined);
    onChange?.(s.session.answers);
  };

  const goBack = () => {
    setError(undefined);
    if (stage !== 'questions') setStage('questions');
    s.back();
  };

  const createBrief = () => {
    if (!brief) return;
    setStage('result');
    onComplete?.(brief, s.session.answers);
  };

  const startOver = () => {
    s.reset();
    setError(undefined);
    setStage('questions');
  };

  const cls = ['ld-form', props.className].filter(Boolean).join(' ');

  if (stage === 'result' && brief) {
    const output = renderBrief(brief, format, renderOptions);
    return (
      <section className={cls} data-stage="result">
        <h3 className="ld-title" tabIndex={-1} ref={headingRef}>Your brief is ready</h3>
        {formats.length > 1 && (
          <div className="ld-tabs" role="tablist" aria-label="Brief format">
            {formats.map((f) => (
              <button key={f} type="button" role="tab" aria-selected={f === format} className="ld-tab" onClick={() => setFormat(f)}>
                {FORMAT_LABELS[f]}
              </button>
            ))}
          </div>
        )}
        <pre className="ld-output" tabIndex={0} aria-label={`${FORMAT_LABELS[format]} brief`}>{output}</pre>
        <div className="ld-actions">
          <CopyButton text={output} label={`Copy ${FORMAT_LABELS[format]}`} />
          <button type="button" className="ld-btn" onClick={() => download(FILE_NAMES[format], output)}>
            Download {FILE_NAMES[format]}
          </button>
          {resultActions?.({ brief, answers: s.session.answers, format, output })}
          <button type="button" className="ld-btn ld-btn-quiet" onClick={() => setStage('review')}>Back to review</button>
          <button type="button" className="ld-btn ld-btn-quiet" onClick={startOver}>Start over</button>
        </div>
      </section>
    );
  }

  if (stage === 'review' && brief) {
    return (
      <section className={cls} data-stage="review">
        <h3 className="ld-title" tabIndex={-1} ref={headingRef}>Review</h3>
        {issues.length === 0 ? (
          <p className="ld-ok">No issues. This brief gives an agent plenty to work with.</p>
        ) : (
          <ul className="ld-issues">
            {issues.map((i, n) => (
              <li key={n} className={`ld-issue ld-issue-${i.level}`}>
                <span className="ld-badge">{i.level === 'warn' ? 'Fix' : 'Tip'}</span> {i.message}
              </li>
            ))}
          </ul>
        )}
        <div className="ld-actions">
          <button type="button" className="ld-btn ld-btn-primary" onClick={createBrief}>Create brief</button>
          <button type="button" className="ld-btn ld-btn-quiet" onClick={goBack}>Back</button>
        </div>
      </section>
    );
  }

  const q = s.current;
  if (!q) return null;
  const section = s.session.sections.find((x) => x.id === q.section);
  return (
    <section className={cls} data-stage="questions">
      <div className="ld-progress">
        <span className="ld-section">{section?.title ?? q.section}</span>
        <span className="ld-count">{s.progress.index} of {s.progress.total}</span>
        <div className="ld-bar" role="progressbar" aria-valuemin={0} aria-valuemax={s.progress.total} aria-valuenow={s.progress.index - 1} aria-label="Progress">
          <div style={{ width: `${((s.progress.index - 1) / s.progress.total) * 100}%` }} />
        </div>
      </div>
      <QuestionField
        key={q.id}
        question={q}
        initial={s.session.draft(q.id) ?? q.default}
        error={error}
        headingRef={headingRef}
        canGoBack={s.session.canGoBack}
        onBack={goBack}
        onSubmit={submit}
      />
    </section>
  );
}

// ── Question field ───────────────────────────────────────────

interface FieldProps {
  question: Question;
  initial?: AnswerValue;
  error?: string;
  headingRef: RefObject<HTMLHeadingElement>;
  canGoBack: boolean;
  onBack: () => void;
  onSubmit: (value: AnswerValue | undefined) => void;
}

function QuestionField({ question: q, initial, error, headingRef, canGoBack, onBack, onSubmit }: FieldProps) {
  const id = useId();
  const [text, setText] = useState(() =>
    initial === undefined || typeof initial === 'boolean' ? '' : Array.isArray(initial) ? (q.type === 'list' ? initial.join('\n') : '') : initial,
  );
  const known = new Set(q.choices?.map((c) => c.value));
  const [picked, setPicked] = useState<string[]>(() =>
    initial === undefined || typeof initial === 'boolean' ? [] : (Array.isArray(initial) ? initial : [initial]).filter((v) => known.has(v)),
  );
  const [other, setOther] = useState(() =>
    initial === undefined || typeof initial === 'boolean' ? '' : (Array.isArray(initial) ? initial : [initial]).filter((v) => !known.has(v)).join(', '),
  );

  const value = (): AnswerValue | undefined => {
    switch (q.type) {
      case 'text':
      case 'longtext':
        return text.trim() || undefined;
      case 'list':
        return text.split('\n').map((s) => s.trim()).filter(Boolean);
      case 'select':
        return other.trim() || picked[0] || undefined;
      case 'multiselect':
        return [...picked, ...other.split(',').map((s) => s.trim()).filter(Boolean)];
      case 'confirm':
        return undefined;
    }
  };

  const onFormSubmit = (e: FormEvent) => { e.preventDefault(); onSubmit(value()); };
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const describedBy = [q.help ? helpId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;

  const toggle = (v: string) => {
    if (q.type === 'select') { setPicked([v]); setOther(''); return; }
    setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : q.max && p.length >= q.max ? p : [...p, v]));
  };

  let field: ReactNode;
  if (q.type === 'text') {
    field = <input id={id} className="ld-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={q.example ? `e.g. ${q.example}` : undefined} aria-describedby={describedBy} autoComplete="off" />;
  } else if (q.type === 'longtext' || q.type === 'list') {
    field = (
      <textarea id={id} className="ld-input ld-textarea" rows={q.type === 'list' ? 4 : 3} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={q.example ? `e.g. ${q.example}` : undefined} aria-describedby={describedBy}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onFormSubmit(e); }} />
    );
  } else if (q.type === 'confirm') {
    field = (
      <div className="ld-actions">
        <button type="button" className="ld-btn ld-btn-primary" onClick={() => onSubmit(true)}>Yes</button>
        <button type="button" className="ld-btn" onClick={() => onSubmit(false)}>No</button>
      </div>
    );
  } else {
    field = (
      <>
        <div className="ld-choices" role={q.type === 'select' ? 'radiogroup' : 'group'} aria-labelledby={`${id}-q`} aria-describedby={describedBy}>
          {q.choices?.map((c) => {
            const on = picked.includes(c.value);
            return (
              <button key={c.value} type="button" className="ld-choice" role={q.type === 'select' ? 'radio' : 'checkbox'} aria-checked={on} onClick={() => toggle(c.value)}>
                <span className="ld-choice-label">{c.label}</span>
                {c.hint && <span className="ld-choice-hint">{c.hint}</span>}
              </button>
            );
          })}
        </div>
        {q.allowOther && (
          <input className="ld-input ld-other" value={other} aria-label={q.type === 'multiselect' ? 'Other (comma-separated)' : 'Other'}
            placeholder={q.type === 'multiselect' ? 'Other, comma-separated' : 'Or type your own'}
            onChange={(e) => { setOther(e.target.value); if (q.type === 'select' && e.target.value) setPicked([]); }} />
        )}
        {q.max && <p className="ld-hint">Pick up to {q.max}.</p>}
      </>
    );
  }

  return (
    <form className="ld-question" onSubmit={onFormSubmit} noValidate>
      <h3 className="ld-title" id={`${id}-q`} tabIndex={-1} ref={headingRef}>
        <label htmlFor={q.type === 'text' || q.type === 'longtext' || q.type === 'list' ? id : undefined}>{q.prompt}</label>
        {q.required && <span className="ld-req" aria-label="required"> *</span>}
      </h3>
      {q.help && <p className="ld-help" id={helpId}>{q.help}</p>}
      {q.type === 'list' && <p className="ld-hint">One per line.</p>}
      {field}
      {error && <p className="ld-error" id={errId} role="alert">{error}</p>}
      {q.type !== 'confirm' && (
        <div className="ld-actions">
          <button type="submit" className="ld-btn ld-btn-primary">Next</button>
          {!q.required && <button type="button" className="ld-btn ld-btn-quiet" onClick={() => onSubmit(undefined)}>Skip</button>}
          {canGoBack && <button type="button" className="ld-btn ld-btn-quiet" onClick={onBack}>Back</button>}
        </div>
      )}
    </form>
  );
}

// ── Helpers ──────────────────────────────────────────────────

export function CopyButton({ text, label = 'Copy', className = 'ld-btn' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={className} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* clipboard blocked */ }
    }}>
      <span aria-live="polite">{done ? 'Copied' : label}</span>
    </button>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: name.endsWith('.json') ? 'application/json' : 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
