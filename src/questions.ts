import type { Choice, Question, Section } from './types.js';

export const SECTIONS: Section[] = [
  { id: 'project', title: 'Project', intro: 'What are we making?' },
  { id: 'users', title: 'Users', intro: 'Who is it for, and what are they trying to do?' },
  { id: 'goals', title: 'Goals', intro: 'What does success look like, and what is out of scope?' },
  { id: 'constraints', title: 'Constraints', intro: 'What must the agent work within?' },
  { id: 'tone', title: 'Tone', intro: 'How should it look, read and feel?' },
];

/**
 * Turns tone adjectives into concrete instructions an agent can act on.
 * Keys are the `value`s of the tone choices below.
 */
export const TONE_GUIDANCE: Record<string, { label: string; hint: string; do: string; avoid: string }> = {
  calm: {
    hint: 'quiet, spacious, unhurried',
    label: 'Calm',
    do: 'Generous whitespace, muted palette, one clear focal point per screen, gentle motion.',
    avoid: 'Urgency cues, countdowns, red badges, dense layouts.',
  },
  bold: {
    hint: 'confident, high contrast',
    label: 'Bold',
    do: 'High contrast, large confident type, strong color blocks, decisive copy.',
    avoid: 'Timid hedging copy, low-contrast greys, many competing accents.',
  },
  playful: {
    hint: 'light, witty, rounded',
    label: 'Playful',
    do: 'Light humor in microcopy, rounded shapes, delightful empty states and small celebrations.',
    avoid: 'Jokes in errors or anything involving money, health or loss.',
  },
  professional: {
    hint: 'precise, restrained',
    label: 'Professional',
    do: 'Plain, precise language, consistent grid, restrained color, clear hierarchy.',
    avoid: 'Slang, exclamation points, decorative flourishes.',
  },
  warm: {
    hint: 'human, encouraging',
    label: 'Warm',
    do: 'Second person ("you"), encouraging copy, soft warm hues, human imagery or illustration.',
    avoid: 'Cold system language ("Invalid input"), stark pure-black-on-white.',
  },
  minimal: {
    hint: 'only what is needed',
    label: 'Minimal',
    do: 'Fewest possible elements, a restrained type scale, progressive disclosure.',
    avoid: 'Decorative chrome, redundant labels, more than one primary button per view.',
  },
  technical: {
    hint: 'exact, data-forward',
    label: 'Technical',
    do: 'Exact terminology, visible data and states, monospace for values, keyboard shortcuts.',
    avoid: 'Vague marketing language, hiding detail the user needs to decide.',
  },
  premium: {
    hint: 'refined, high-end',
    label: 'Premium',
    do: 'Refined typography, ample spacing, high-quality imagery, slow and subtle motion.',
    avoid: 'Discount cues, clutter, stock-photo clichés, loud gradients.',
  },
  friendly: {
    hint: 'approachable, helpful',
    label: 'Friendly',
    do: 'Conversational copy, helpful hints at the point of need, approachable rounded UI.',
    avoid: 'Jargon, walls of text, blame in error messages.',
  },
  editorial: {
    hint: 'type-led, considered',
    label: 'Editorial',
    do: 'Strong typographic hierarchy, considered reading measure, imagery with intent.',
    avoid: 'Generic card grids, centered body copy, icon soup.',
  },
};

/** Tone pairs that pull in opposite directions; the brief should say which wins. */
export const TONE_TENSIONS: Array<[string, string]> = [
  ['calm', 'bold'],
  ['playful', 'premium'],
  ['minimal', 'editorial'],
  ['playful', 'technical'],
];

const toneChoices: Choice[] = Object.entries(TONE_GUIDANCE).map(([value, t]) => ({
  value,
  label: t.label,
  hint: t.hint,
}));

export const ACCESSIBILITY_CHOICES: Choice[] = [
  { value: 'WCAG 2.2 AA', label: 'WCAG 2.2 AA' },
  { value: 'Screen reader support', label: 'Screen reader support' },
  { value: 'Full keyboard navigation', label: 'Full keyboard navigation' },
  { value: 'Respect reduced motion', label: 'Respect reduced motion' },
  { value: 'Large text / older adults', label: 'Large text / older adults' },
  { value: 'Low bandwidth / slow devices', label: 'Low bandwidth / slow devices' },
];

export const DEFAULT_QUESTIONS: Question[] = [
  // ── Project ────────────────────────────────────────────────
  {
    id: 'name',
    section: 'project',
    type: 'text',
    prompt: 'What is the project called?',
    example: 'HealthHub onboarding',
    required: true,
  },
  {
    id: 'summary',
    section: 'project',
    type: 'longtext',
    prompt: 'In a sentence or two, what are you making?',
    help: 'The agent reads this first. Say what it is, not how it works.',
    example: 'A three-step onboarding flow that gets new members to book their first coaching session.',
    required: true,
  },
  {
    id: 'kind',
    section: 'project',
    type: 'select',
    prompt: 'What kind of thing is it?',
    quick: true,
    allowOther: true,
    choices: [
      { value: 'web-app', label: 'Web app / product UI' },
      { value: 'marketing-site', label: 'Marketing site or landing page' },
      { value: 'mobile-app', label: 'Mobile app' },
      { value: 'dashboard', label: 'Dashboard / data UI' },
      { value: 'components', label: 'Components / design system' },
      { value: 'content', label: 'Content or visual asset' },
    ],
  },
  {
    id: 'fidelity',
    section: 'project',
    type: 'select',
    prompt: 'How finished should the output be?',
    help: 'Stops the agent from polishing a sketch or sketching a release.',
    quick: true,
    choices: [
      { value: 'sketch', label: 'Sketch', hint: 'explore ideas fast, rough is fine' },
      { value: 'prototype', label: 'Prototype', hint: 'clickable, realistic content, not hardened' },
      { value: 'production', label: 'Production', hint: 'shippable: states, errors, tests, a11y' },
    ],
  },

  // ── Users ──────────────────────────────────────────────────
  {
    id: 'primaryUsers',
    section: 'users',
    type: 'text',
    prompt: 'Who is the primary user?',
    help: 'Be specific. "Everyone" gives the agent nothing to design for.',
    example: 'Busy parents in their 30s booking care between other tasks, mostly on their phone',
    required: true,
  },
  {
    id: 'userContext',
    section: 'users',
    type: 'longtext',
    prompt: 'What are they trying to get done, and in what situation?',
    example: 'Find an open slot this week and book it in under a minute, often one-handed.',
    quick: true,
  },
  {
    id: 'accessibility',
    section: 'users',
    type: 'multiselect',
    prompt: 'Accessibility requirements?',
    choices: ACCESSIBILITY_CHOICES,
    allowOther: true,
    default: ['WCAG 2.2 AA'],
  },

  // ── Goals ──────────────────────────────────────────────────
  {
    id: 'goals',
    section: 'goals',
    type: 'list',
    prompt: 'What does success look like?',
    help: 'One per line. Observable outcomes beat adjectives.',
    example: 'A new member books a session in under 60 seconds',
    required: true,
  },
  {
    id: 'primaryAction',
    section: 'goals',
    type: 'text',
    prompt: 'What is the single most important action on the main screen?',
    help: 'The agent will give this the strongest visual weight.',
    example: 'Book a session',
    quick: true,
  },
  {
    id: 'nonGoals',
    section: 'goals',
    type: 'list',
    prompt: 'What is explicitly out of scope?',
    help: 'Agents over-build. Saying no here saves a lot of review time.',
    example: 'Payments, account settings, dark mode',
    quick: true,
  },

  // ── Constraints ────────────────────────────────────────────
  {
    id: 'platforms',
    section: 'constraints',
    type: 'multiselect',
    prompt: 'Which platforms or screen sizes must it support?',
    allowOther: true,
    choices: [
      { value: 'Mobile web', label: 'Mobile web' },
      { value: 'Desktop web', label: 'Desktop web' },
      { value: 'Tablet', label: 'Tablet' },
      { value: 'iOS', label: 'iOS native' },
      { value: 'Android', label: 'Android native' },
    ],
  },
  {
    id: 'stack',
    section: 'constraints',
    type: 'text',
    prompt: 'Stack or design system the agent must use?',
    example: 'React + Tailwind; use components from @acme/ui before building new ones',
    quick: true,
  },
  {
    id: 'mustInclude',
    section: 'constraints',
    type: 'list',
    prompt: 'Anything it must include?',
    example: 'Existing logo and brand colors',
  },
  {
    id: 'mustAvoid',
    section: 'constraints',
    type: 'list',
    prompt: 'Anything it must avoid?',
    example: 'Modals on mobile',
  },

  // ── Tone ───────────────────────────────────────────────────
  {
    id: 'tone',
    section: 'tone',
    type: 'multiselect',
    prompt: 'Pick up to three words for how it should feel.',
    help: 'Each word becomes concrete do / avoid guidance in the brief.',
    choices: toneChoices,
    allowOther: true,
    max: 3,
    quick: true,
  },
  {
    id: 'references',
    section: 'tone',
    type: 'list',
    prompt: 'Any products or brands that capture the feel?',
    example: 'Headspace onboarding; Linear for density',
  },
  {
    id: 'antiTone',
    section: 'tone',
    type: 'text',
    prompt: 'Anything it should never feel like?',
    example: 'A hospital form',
  },
];

/** Known built-in ids, used to separate custom answers into `brief.extra`. */
export const BUILT_IN_IDS = new Set(DEFAULT_QUESTIONS.map((q) => q.id));
