import type { Choice, Question, Section } from './types.js';

export const SECTIONS: Section[] = [
  { id: 'project', title: 'Project', intro: 'What are we making?' },
  { id: 'specifics', title: 'Specifics', intro: 'A few questions for this kind of project' },
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

  // ── Specifics: asked only for the matching kind of project ──
  ...projectSpecifics(),

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
    id: 'secondaryUsers',
    section: 'users',
    type: 'list',
    prompt: 'Anyone else who uses it?',
    help: 'Secondary users get supporting paths, never the main screen.',
    example: 'Clinic staff who confirm bookings',
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
    id: 'goalPriority',
    section: 'goals',
    type: 'rank',
    rankFrom: 'goals',
    prompt: 'Put your goals in order. Which wins when they conflict?',
    help: 'Agents trade goals off constantly. The order tells them how.',
    when: (a) => Array.isArray(a.goals) && a.goals.length > 1,
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
    id: 'content',
    section: 'constraints',
    type: 'select',
    prompt: 'Is real content available?',
    help: 'Stops lorem ipsum, and stops the agent rewriting copy you have already approved.',
    choices: [
      { value: 'real', label: 'Real content', hint: 'use what is provided, word for word' },
      { value: 'some', label: 'Some real content', hint: 'realistic placeholders for the rest' },
      { value: 'none', label: 'No content yet', hint: 'write realistic placeholder copy' },
    ],
  },
  {
    id: 'brandAssets',
    section: 'constraints',
    type: 'list',
    prompt: 'Links to brand assets (logo, colors, fonts)?',
    example: 'Logo: brand.acme.com/logo.svg; Colors: #1E4D36, #EAC26C; Font: Manrope',
  },
  {
    id: 'crossCutting',
    section: 'constraints',
    type: 'multiselect',
    prompt: 'Anything that applies everywhere?',
    allowOther: true,
    choices: [
      { value: 'Dark mode', label: 'Dark mode' },
      { value: 'Localization', label: 'Localization / translation' },
      { value: 'Right-to-left languages', label: 'Right-to-left languages' },
      { value: 'Works offline', label: 'Works offline' },
      { value: 'Print-friendly', label: 'Print-friendly' },
    ],
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
    prompt: 'Any products or brands that capture the feel, and what to borrow from each?',
    help: 'Name what to take, or the agent copies the whole thing. Format: product — what to borrow.',
    example: 'Headspace — the calm pacing; Linear — the information density',
  },
  {
    id: 'antiTone',
    section: 'tone',
    type: 'text',
    prompt: 'Anything it should never feel like?',
    example: 'A hospital form',
  },
];

const labelsToValues = (id: string): Record<string, string> =>
  Object.fromEntries((DEFAULT_QUESTIONS.find((q) => q.id === id)?.choices ?? []).map((c) => [c.label.toLowerCase(), c.value]));

/** Lower-cased choice label → value, for reading Markdown briefs back in. */
export const FIDELITY_LABELS = labelsToValues('fidelity');
export const CONTENT_CHOICE_LABELS = labelsToValues('content');

/** Known built-in ids, used to separate custom answers into `brief.extra`. */
export const BUILT_IN_IDS = new Set(DEFAULT_QUESTIONS.map((q) => q.id));

const PROJECT_LABELS: Record<string, string> = {
  'web-app': 'web app',
  'marketing-site': 'marketing site',
  'mobile-app': 'mobile app',
  dashboard: 'dashboard',
  components: 'component library',
  content: 'content piece',
};

/** Label for a project kind, e.g. "dashboard". */
export const projectLabel = (kind?: string) => (kind ? (PROJECT_LABELS[kind] ?? kind) : undefined);

/** Question sets by project type. Each is asked only when `kind` matches. */
function projectSpecifics(): Question[] {
  const forKind = (kind: string, qs: Array<Omit<Question, 'section' | 'condition'>>): Question[] =>
    qs.map((q) => ({ ...q, section: 'specifics', condition: { kind } }));
  return [
    ...forKind('web-app', [
      {
        id: 'keyFlows',
        type: 'list',
        prompt: 'What are the key flows, start to finish?',
        help: 'The agent builds these end to end before anything else.',
        example: 'Sign up → pick a coach → book a session',
        quick: true,
      },
    ]),
    ...forKind('marketing-site', [
      {
        id: 'conversionGoal',
        type: 'text',
        prompt: 'What should a visitor do before they leave?',
        example: 'Start a free trial',
        quick: true,
      },
      {
        id: 'trafficSource',
        type: 'multiselect',
        prompt: 'Where do visitors come from?',
        help: 'Search visitors scan; ad visitors expect the ad\'s promise above the fold.',
        allowOther: true,
        choices: [
          { value: 'Search', label: 'Search' },
          { value: 'Paid ads', label: 'Paid ads' },
          { value: 'Social', label: 'Social' },
          { value: 'Email', label: 'Email' },
          { value: 'Word of mouth', label: 'Word of mouth' },
          { value: 'Returning visitors', label: 'Returning visitors' },
        ],
      },
      {
        id: 'proofPoints',
        type: 'list',
        prompt: 'What proof can the page use?',
        help: 'Real numbers, quotes and logos. The agent should never invent these.',
        example: '4.8 stars from 2,000 reviews; logos of three partner clinics',
      },
    ]),
    ...forKind('mobile-app', [
      {
        id: 'offline',
        type: 'select',
        prompt: 'Does it need to work offline?',
        quick: true,
        choices: [
          { value: 'full', label: 'Fully offline', hint: 'everything works, syncs later' },
          { value: 'read', label: 'Read-only offline', hint: 'browse cached content' },
          { value: 'online', label: 'Online only' },
        ],
      },
      { id: 'oneHanded', type: 'confirm', prompt: 'Is it mostly used one-handed or on the go?' },
      {
        id: 'platformStyle',
        type: 'select',
        prompt: 'Native look on each platform, or one shared design?',
        choices: [
          { value: 'native', label: 'Follow iOS and Android conventions' },
          { value: 'shared', label: 'One custom design on both' },
        ],
      },
    ]),
    ...forKind('dashboard', [
      {
        id: 'keyMetrics',
        type: 'list',
        prompt: 'Which numbers matter most?',
        help: 'These get the top of the screen; everything else is a drill-down.',
        example: 'Weekly bookings; no-show rate; revenue by clinic',
        quick: true,
      },
      {
        id: 'dataDensity',
        type: 'scale',
        prompt: 'How dense should it be?',
        min: 1,
        max: 5,
        minLabel: 'Spacious',
        maxLabel: 'Dense',
      },
      {
        id: 'freshness',
        type: 'select',
        prompt: 'How fresh is the data?',
        choices: [
          { value: 'realtime', label: 'Real-time' },
          { value: 'hourly', label: 'Hourly' },
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly or less' },
        ],
      },
    ]),
    ...forKind('components', [
      {
        id: 'componentScope',
        type: 'list',
        prompt: 'Which components are in scope?',
        example: 'Button, Input, Select, Modal',
        quick: true,
      },
      {
        id: 'tokensSource',
        type: 'text',
        prompt: 'Where do the design tokens live?',
        example: 'tokens.json, or Figma variables',
      },
      { id: 'usageDocs', type: 'confirm', prompt: 'Include usage docs and examples for each component?' },
    ]),
    ...forKind('content', [
      {
        id: 'format',
        type: 'text',
        prompt: 'What format and size?',
        example: 'Instagram carousel, 1080×1350, 6 slides',
        quick: true,
      },
      { id: 'channel', type: 'text', prompt: 'Where will people see it?', example: 'Instagram and LinkedIn' },
    ]),
  ];
}
