import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { isEmpty, rankItems, scaleRange } from './answers.js';
import type { Assistant, Rewrite } from './assist.js';
import { followUpFor, type FollowUp } from './followups.js';
import { lintBrief, questionForField } from './lint.js';
import { renderBrief, toHTML, type RenderOptions } from './render.js';
import { scoreBrief, scoreTips } from './score.js';
import { BriefSession } from './session.js';
import type { AnswerValue, Answers, Brief, LintIssue, OutputFormat, Question, ToneGuidance } from './types.js';

export interface UseBriefSessionOptions {
  questions?: Question[];
  quick?: boolean;
  initialAnswers?: Answers;
  /** Do/avoid guidance for your own tone words, keyed by choice value. */
  toneGuidance?: Record<string, ToneGuidance>;
}

/** React state around a headless BriefSession. Re-renders on every step. */
export function useBriefSession(opts: UseBriefSessionOptions = {}) {
  const ref = useRef<BriefSession>();
  if (!ref.current) ref.current = new BriefSession({ questions: opts.questions, quick: opts.quick, answers: opts.initialAnswers, toneGuidance: opts.toneGuidance });
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
    set: (id: string, value: AnswerValue | undefined) => { const r = session.set(id, value); bump(); return r; },
    reset: (answers?: Answers) => {
      ref.current = new BriefSession({ questions: opts.questions, quick: opts.quick, answers, toneGuidance: opts.toneGuidance });
      bump();
    },
  };
}

const FILE_NAMES: Record<OutputFormat, string> = { markdown: 'BRIEF.md', prompt: 'brief-prompt.txt', json: 'brief.json', html: 'brief.html' };
const FORMAT_LABELS: Record<OutputFormat, string> = { markdown: 'Markdown', prompt: 'Prompt', json: 'JSON', html: 'HTML' };

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
  /** Do/avoid guidance for your own tone words, keyed by choice value. */
  toneGuidance?: Record<string, ToneGuidance>;
  /** Show the brief strength score in the review step. Default true. */
  showScore?: boolean;
  /** Show a "Print or save as PDF" button on the result screen. Default true. */
  printButton?: boolean;
  /** Ask one more question when an answer is too vague to design from. Works offline. Default true. */
  followUps?: boolean;
  /**
   * Optional AI help: tailored follow-ups and a "Suggest sharper answers" button in the review.
   * Build one with createAssistant({ complete }), where complete calls your own server route.
   */
  assistant?: Assistant;
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
  const s = useBriefSession({ questions: props.questions, quick: props.quick, initialAnswers: props.initialAnswers, toneGuidance: props.toneGuidance });
  const canStartAtResult = props.startAtResult && s.session.missingRequired().length === 0;
  const [stage, setStage] = useState<Stage>(canStartAtResult ? 'result' : 'questions');
  const [format, setFormat] = useState<OutputFormat>(formats[0] ?? 'markdown');
  const [error, setError] = useState<string>();
  const [rewrites, setRewrites] = useState<RewriteState>({ state: 'idle' });
  const [pending, setPending] = useState<{ fu: FollowUp; question: Question; value: AnswerValue; prompt: string }>();
  const asked = useRef(new Set<string>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (stage === 'questions' && s.isComplete && !pending) setStage('review');
  }, [stage, s.isComplete, pending]);

  const qid = s.current?.id;
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [qid, stage, pending?.question.id]);

  const brief = useMemo(
    () => (stage === 'questions' ? undefined : s.session.missingRequired().length ? undefined : s.session.toBrief()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stage, JSON.stringify(s.answers)],
  );
  const issues: LintIssue[] = useMemo(() => (brief ? lintBrief(brief) : []), [brief]);
  const score = useMemo(() => (brief ? scoreBrief(brief, issues) : undefined), [brief, issues]);

  const submit = (value: AnswerValue | undefined) => {
    const question = s.current;
    const r = value === undefined || isEmpty(value) ? s.skip() : s.answer(value);
    if (!r.ok) { setError(r.error); return; }
    setError(undefined);
    onChange?.(s.session.answers);
    // A vague answer gets one more question, once per question.
    const given = question ? s.session.answers[question.id] : undefined;
    const fu = question && props.followUps !== false && !asked.current.has(question.id) ? followUpFor(question, given, s.session.answers) : undefined;
    if (fu && question && given !== undefined) {
      asked.current.add(question.id);
      setPending({ fu, question, value: given, prompt: fu.prompt });
      props.assistant?.followUpQuestion(fu, given, s.session.answers).then(
        (prompt) => setPending((p) => (p && p.fu === fu ? { ...p, prompt } : p)),
        () => { /* keep the offline question */ },
      );
    }
  };

  const resolveFollowUp = async (reply: string) => {
    if (!pending) return;
    const { fu, question, value, prompt } = pending;
    if (reply.trim()) {
      let merged = fu.merge(value, reply);
      if (props.assistant) {
        try { merged = await props.assistant.mergeFollowUp(fu, value, prompt, reply, s.session.answers); } catch { /* offline merge */ }
      }
      const r = s.set(question.id, merged);
      if (!r.ok) { setError(r.error); return; }
      onChange?.(s.session.answers);
    }
    setError(undefined);
    setPending(undefined);
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
          {props.printButton !== false && (
            <button type="button" className="ld-btn" onClick={() => printHTML(toHTML(brief, renderOptions))}>Print or save as PDF</button>
          )}
          {resultActions?.({ brief, answers: s.session.answers, format, output })}
          <button type="button" className="ld-btn ld-btn-quiet" onClick={() => setStage('review')}>Back to review</button>
          <button type="button" className="ld-btn ld-btn-quiet" onClick={startOver}>Start over</button>
        </div>
      </section>
    );
  }

  if (stage === 'review' && brief) {
    const fixable = props.assistant ? issues.filter((i) => questionForField(i.field) && s.session.find(questionForField(i.field)!)) : [];
    return (
      <section className={cls} data-stage="review">
        <h3 className="ld-title" tabIndex={-1} ref={headingRef}>Review</h3>
        {score && props.showScore !== false && (
          <div className="ld-score" data-grade={score.grade.toLowerCase()}>
            <div className="ld-score-head">
              <span className="ld-score-label">Brief strength</span>
              <span className="ld-score-value">{score.score}/100 · {score.grade}</span>
            </div>
            <div className="ld-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score.score} aria-valuetext={`${score.score} out of 100, ${score.grade}`} aria-label="Brief strength">
              <span className="ld-meter-fill" style={{ width: `${score.score}%` }} />
            </div>
            {scoreTips(score).length > 0 && (
              <ul className="ld-next" aria-label="To raise the score">
                {scoreTips(score).map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
          </div>
        )}
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
        {props.assistant && (fixable.length > 0 || rewrites.state !== 'idle') && (
          <Rewrites assistant={props.assistant} brief={brief} answers={s.answers} issues={fixable} questions={s.session.questions}
            state={rewrites} setState={setRewrites} onUse={(r) => { const res = s.set(r.questionId, r.suggestion); if (res.ok) onChange?.(s.session.answers); }} />
        )}
        <div className="ld-actions">
          <button type="button" className="ld-btn ld-btn-primary" onClick={createBrief}>Create brief</button>
          <button type="button" className="ld-btn ld-btn-quiet" onClick={goBack}>Back</button>
        </div>
      </section>
    );
  }

  if (pending) {
    const section = s.session.sections.find((x) => x.id === pending.question.section);
    return (
      <section className={cls} data-stage="follow-up">
        <div className="ld-progress">
          <span className="ld-section">{section?.title ?? pending.question.section}</span>
          <span className="ld-count">One more thing</span>
        </div>
        <FollowUpField key={pending.question.id} pending={pending} error={error} headingRef={headingRef} onDone={resolveFollowUp} />
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
        answers={s.answers}
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
  answers: Answers;
  initial?: AnswerValue;
  error?: string;
  headingRef: RefObject<HTMLHeadingElement>;
  canGoBack: boolean;
  onBack: () => void;
  onSubmit: (value: AnswerValue | undefined) => void;
}

function QuestionField({ question: q, answers, initial, error, headingRef, canGoBack, onBack, onSubmit }: FieldProps) {
  const id = useId();
  const init: string[] = initial === undefined || typeof initial === 'boolean' ? [] : Array.isArray(initial) ? initial : [String(initial)];
  const [text, setText] = useState(() => (typeof initial === 'string' ? initial : q.type === 'list' ? init.join('\n') : ''));
  const { min, max } = scaleRange(q);
  const scaleValues = q.type === 'scale' ? Array.from({ length: max - min + 1 }, (_, i) => String(min + i)) : [];
  const known = new Set(q.type === 'scale' ? scaleValues : q.choices?.map((c) => c.value));
  const [picked, setPicked] = useState<string[]>(() => init.filter((v) => known.has(v)));
  const [other, setOther] = useState(() => (q.type === 'select' || q.type === 'multiselect' ? init.filter((v) => !known.has(v)).join(', ') : ''));
  const [order, setOrder] = useState<string[]>(() => {
    const items = rankItems(q, answers);
    const given = init.filter((v) => items.includes(v));
    return [...given, ...items.filter((i) => !given.includes(i))];
  });
  const moveItem = (i: number, by: number) =>
    setOrder((o) => {
      const j = i + by;
      if (j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

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
      case 'scale':
        return picked[0] === undefined ? undefined : Number(picked[0]);
      case 'rank':
        return order;
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
  } else if (q.type === 'scale') {
    field = (
      <div className="ld-scale">
        <div className="ld-scale-row" role="radiogroup" aria-labelledby={`${id}-q`} aria-describedby={describedBy}>
          {scaleValues.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={picked[0] === v} className="ld-scale-step"
              aria-label={v === String(min) && q.minLabel ? `${v}, ${q.minLabel}` : v === String(max) && q.maxLabel ? `${v}, ${q.maxLabel}` : v}
              onClick={() => setPicked([v])}>
              {v}
            </button>
          ))}
        </div>
        {(q.minLabel || q.maxLabel) && (
          <div className="ld-scale-ends" aria-hidden="true"><span>{q.minLabel}</span><span>{q.maxLabel}</span></div>
        )}
      </div>
    );
  } else if (q.type === 'rank') {
    field = (
      <ol className="ld-rank" aria-describedby={describedBy}>
        {order.map((item, i) => (
          <li key={item} className="ld-rank-item">
            <span className="ld-rank-n" aria-hidden="true">{i + 1}</span>
            <span className="ld-rank-label">{item}</span>
            <span className="ld-rank-moves">
              <button type="button" className="ld-rank-move" aria-label={`Move “${item}” up`} disabled={i === 0} onClick={() => moveItem(i, -1)}>↑</button>
              <button type="button" className="ld-rank-move" aria-label={`Move “${item}” down`} disabled={i === order.length - 1} onClick={() => moveItem(i, 1)}>↓</button>
            </span>
          </li>
        ))}
      </ol>
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
      {q.type === 'rank' && <p className="ld-hint">Most important first. The top one wins a conflict.</p>}
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

const MIME: Record<string, string> = { json: 'application/json', html: 'text/html', md: 'text/markdown' };

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: MIME[name.split('.').pop() ?? ''] ?? 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Print a standalone HTML page from a hidden frame, so popup blockers stay out of it. */
function printHTML(html: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

type RewriteState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; items: Array<Rewrite & { status: 'open' | 'used' | 'skipped' }> };

const shown = (q: Question | undefined, v: AnswerValue | undefined) => {
  if (v === undefined) return '';
  const label = (x: string) => q?.choices?.find((c) => c.value === x)?.label ?? x;
  return Array.isArray(v) ? v.map(label).join(' · ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : label(String(v));
};

function Rewrites(props: {
  assistant: Assistant;
  brief: Brief;
  answers: Answers;
  issues: LintIssue[];
  questions: Question[];
  state: RewriteState;
  setState: (s: RewriteState) => void;
  onUse: (r: Rewrite) => void;
}) {
  const { state, setState } = props;
  const ask = async () => {
    setState({ state: 'loading' });
    try {
      const items = await props.assistant.suggestRewrites(props.brief, props.answers, props.issues);
      setState({ state: 'ready', items: items.map((r) => ({ ...r, status: 'open' as const })) });
    } catch (e) {
      setState({ state: 'error', message: (e as Error).message });
    }
  };
  const mark = (i: number, status: 'used' | 'skipped') => {
    if (state.state !== 'ready') return;
    const item = state.items[i]!;
    if (status === 'used') props.onUse(item);
    setState({ state: 'ready', items: state.items.map((x, n) => (n === i ? { ...x, status } : x)) });
  };

  return (
    <div className="ld-rewrites" aria-live="polite">
      {state.state === 'idle' && (
        <button type="button" className="ld-btn" onClick={ask}>Suggest sharper answers</button>
      )}
      {state.state === 'loading' && <p className="ld-hint">Asking for sharper answers…</p>}
      {state.state === 'error' && (
        <p className="ld-error">Couldn't get suggestions: {state.message} <button type="button" className="ld-btn ld-btn-quiet" onClick={ask}>Try again</button></p>
      )}
      {state.state === 'ready' && state.items.length === 0 && <p className="ld-hint">No rewrites to suggest.</p>}
      {state.state === 'ready' && state.items.length > 0 && (
        <ul className="ld-rewrite-list">
          {state.items.map((r, i) => {
            const q = props.questions.find((x) => x.id === r.questionId);
            return (
              <li key={r.questionId} className="ld-rewrite" data-status={r.status}>
                <p className="ld-rewrite-label">{r.label}</p>
                {r.current !== undefined && <p className="ld-rewrite-old"><span className="ld-visually-hidden">Now: </span>{shown(q, r.current)}</p>}
                <p className="ld-rewrite-new"><span className="ld-visually-hidden">Suggested: </span>{shown(q, r.suggestion)}</p>
                {r.why && <p className="ld-hint">{r.why}</p>}
                {r.status === 'open' ? (
                  <div className="ld-actions ld-actions-tight">
                    <button type="button" className="ld-btn" onClick={() => mark(i, 'used')}>Use this</button>
                    <button type="button" className="ld-btn ld-btn-quiet" onClick={() => mark(i, 'skipped')}>Keep mine</button>
                  </div>
                ) : (
                  <p className="ld-hint">{r.status === 'used' ? 'Used.' : 'Kept yours.'}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FollowUpField({ pending, error, headingRef, onDone }: {
  pending: { fu: FollowUp; question: Question; value: AnswerValue; prompt: string };
  error?: string;
  headingRef: RefObject<HTMLHeadingElement>;
  onDone: (reply: string) => void;
}) {
  const id = useId();
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await onDone(reply); } finally { setBusy(false); }
  };
  return (
    <form className="ld-question ld-follow-up" onSubmit={submit} noValidate>
      <p className="ld-hint">You said: <strong>{shown(pending.question, pending.fu.item ?? pending.value)}</strong></p>
      <h3 className="ld-title" id={`${id}-q`} tabIndex={-1} ref={headingRef}><label htmlFor={id}>{pending.prompt}</label></h3>
      <input id={id} className="ld-input" value={reply} onChange={(e) => setReply(e.target.value)} autoComplete="off"
        placeholder={pending.fu.example ? `e.g. ${pending.fu.example}` : undefined} aria-describedby={error ? `${id}-err` : undefined} />
      {error && <p className="ld-error" id={`${id}-err`} role="alert">{error}</p>}
      <div className="ld-actions">
        <button type="submit" className="ld-btn ld-btn-primary" disabled={busy || !reply.trim()}>Update answer</button>
        <button type="button" className="ld-btn ld-btn-quiet" disabled={busy} onClick={() => onDone('')}>Keep my answer</button>
      </div>
    </form>
  );
}
