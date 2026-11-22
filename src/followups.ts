import { BROAD_USERS, MEASURABLE, VAGUE } from './lint.js';
import type { AnswerValue, Answers, Question } from './types.js';

/** One more question to ask when an answer is too vague to design from. */
export interface FollowUp {
  /** The question whose answer is vague. */
  questionId: string;
  /** Why it was flagged, in a few words. Useful as context for an AI rewrite. */
  reason: string;
  /** What to ask next. */
  prompt: string;
  example?: string;
  /** For list answers: the item the follow-up is about. */
  item?: string;
  /** Fold the reply into the original answer. An empty reply keeps the original. */
  merge(original: AnswerValue, reply: string): AnswerValue;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const replaceWith = (_o: AnswerValue, reply: string) => reply.trim();

/**
 * A follow-up question for a vague answer, or undefined when the answer is
 * specific enough. Offline and deterministic: the same checks the brief
 * review uses, applied the moment the answer is given.
 */
export function followUpFor(q: Question, value: AnswerValue | undefined, _answers: Answers = {}): FollowUp | undefined {
  if (value === undefined) return undefined;

  if (q.id === 'primaryUsers' && typeof value === 'string') {
    const v = value.trim();
    if (BROAD_USERS.test(v) || words(v) < 3) {
      return {
        questionId: q.id,
        reason: BROAD_USERS.test(v) ? 'too broad to design for' : 'too short to picture one person',
        prompt: 'Who would use it first? Name one kind of person and their situation.',
        example: 'Busy parents booking care on their phone between pickups',
        merge: (o, reply) => (reply.trim() ? replaceWith(o, reply) : o),
      };
    }
  }

  if (q.id === 'goals' && Array.isArray(value)) {
    const weak = value.find((g) => VAGUE.test(g) && !MEASURABLE.test(g));
    if (weak) {
      return {
        questionId: q.id,
        reason: 'an adjective, not an outcome',
        item: weak,
        prompt: `"${weak}" is hard to check. What could a user do, or how fast?`,
        example: 'A first-time member books a session without help',
        merge: (o, reply) => {
          if (!reply.trim() || !Array.isArray(o)) return o;
          return o.map((g) => (g === weak ? reply.trim() : g));
        },
      };
    }
  }

  if (q.id === 'primaryAction' && typeof value === 'string') {
    const v = value.trim();
    if (/,|\band\b|\bor\b|\//i.test(v) && words(v) > 2) {
      return {
        questionId: q.id,
        reason: 'more than one action',
        prompt: 'If only one of those could be the big button, which one?',
        merge: (o, reply) => (reply.trim() ? replaceWith(o, reply) : o),
      };
    }
  }

  if (q.id === 'summary' && typeof value === 'string' && words(value) < 6) {
    return {
      questionId: q.id,
      reason: 'too short to say what it does',
      prompt: 'In one sentence: what does it do, and for whom?',
      example: 'A three-step flow that gets new members to book their first session',
      merge: (o, reply) => (reply.trim() ? replaceWith(o, reply) : o),
    };
  }

  return undefined;
}
