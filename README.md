<p align="center"><img src="assets/mark.svg" width="96" alt=""></p>

# the-lowdown

**Give your AI agent the lowdown.** A short guided Q&A that writes a design brief (users, goals, constraints, tone) your agent can follow.

[![npm](https://img.shields.io/npm/v/@pixelatlarge/the-lowdown)](https://www.npmjs.com/package/@pixelatlarge/the-lowdown)

**[Try it in your browser →](https://pixelatlarge.github.io/the-lowdown/)** No install, and nothing leaves your browser unless you share the link.

https://github.com/user-attachments/assets/664fe32c-e3d6-4107-a590-d4331334f937

Agents fill gaps with generic defaults: everyone is the user, every feature is in scope, and the tone is "clean and modern". A few minutes of answering the right questions up front stops a lot of rework. `the-lowdown` asks those questions, pushes back on weak answers, and writes a brief in a shape agents follow well:

- **Hard requirements vs. guidance.** Must-include, must-avoid and accessibility items are labelled as non-negotiable; out-of-scope items as do-not-build.
- **Tone becomes instructions.** Pick "calm, warm, playful" and the brief spells out what each means in practice (do / avoid), so the agent isn't left to interpret adjectives.
- **Fidelity sets the bar.** Sketch, prototype or production, so the agent doesn't polish a sketch or sketch a release.
- **A definition of done.** A checklist built from your goals and constraints that the agent can verify against.
- **Quality checks.** Flags "everyone" as a user, adjective-only goals ("intuitive"), empty scope limits and conflicting tone words before you hand it over.

Zero runtime dependencies. Node 18.17+.

## Quick start

Run it without installing, or install it globally to get the `the-lowdown` command:

```sh
npx @pixelatlarge/the-lowdown            # ~17 questions, writes BRIEF.md
npx @pixelatlarge/the-lowdown --quick    # ~11 essential questions

npm i -g @pixelatlarge/the-lowdown
the-lowdown
```

<img src="assets/demo.gif" alt="A quick-mode run in the terminal: eleven questions, a clean review, then BRIEF.md is written and linked from CLAUDE.md" width="760">

Then point your agent at it:

```sh
npx @pixelatlarge/the-lowdown link      # or add --link when you create the brief
```

This adds a short "follow BRIEF.md" block to the agent instruction files you already have: `CLAUDE.md`, `AGENTS.md`, Cursor rules or Copilot instructions. If you have none, it creates `AGENTS.md`. Running it again updates the block instead of adding another, and nothing else in those files is touched. Pick files explicitly with `--link-to claude,cursor`.

While answering: **Enter** skips an optional question (or accepts the default), **`<`** goes back, **`?`** explains why a question matters. Choices accept numbers (`1,3`), labels, or your own words where allowed.

## What it asks

| Section | Questions |
| --- | --- |
| Project | Name\*, summary\*, kind, fidelity |
| Users | Primary user\*, situation, accessibility |
| Goals | Success criteria\*, primary action, out of scope |
| Constraints | Platforms, stack / design system, must include, must avoid |
| Tone | Up to three tone words, references, "never feel like" |

\* required

## CLI

```
the-lowdown [init] [options]     Run the guided Q&A (default)
the-lowdown render <file>        Render an answers or brief JSON file
the-lowdown lint <file>          Check a brief for weak spots (exit 1 on warnings)
the-lowdown questions            Print the question schema as JSON (for agents)
the-lowdown link [brief]         Point CLAUDE.md / AGENTS.md / Cursor rules at a brief

-o, --out <file>          Output file. Default: BRIEF.md for init, stdout for render. "-" = stdout
-f, --format <fmt>        markdown | prompt | json  (default: from --out extension)
-q, --quick               Essential questions only
    --answers <file>      Prefill from JSON; only missing questions are asked
    --save-answers <file> Also save raw answers (edit and re-render later)
    --no-instructions     Leave out the "How to use this brief" section
    --no-checklist        Leave out the definition-of-done checklist
    --link                After writing, point your agent instruction files at the brief
    --link-to <list>      claude, agents, cursor, copilot (default: whichever exist, else AGENTS.md)
-y, --yes                 Don't ask before writing or overwriting
```

| `--link-to` | File |
| --- | --- |
| `claude` | `CLAUDE.md` |
| `agents` | `AGENTS.md` |
| `cursor` | `.cursor/rules/the-lowdown.mdc` (always-applied rule) |
| `copilot` | `.github/copilot-instructions.md` |

### Output formats

- **`markdown`** (default): a readable `BRIEF.md` for repos, docs and humans.
- **`prompt`**: compact XML-tagged text (`<design_brief>`, `<users>`, `<tone>`…) to paste into a system prompt or agent config.
- **`json`**: the typed `Brief` object, for tooling.

### Let the agent run the interview

`the-lowdown questions` prints the question schema plus interview instructions. Give it to an agent (Claude Code, Cursor, a custom chat UI) and it can conduct the Q&A conversationally, save the answers as JSON, and run `the-lowdown render answers.json -o BRIEF.md`.

## API

```ts
import { createBrief, buildBrief, lintBrief, renderBrief, shareUrl, answersFromHash } from '@pixelatlarge/the-lowdown';

// Answers in, brief out
const md = createBrief({
  name: 'HealthHub onboarding',
  summary: 'A three-step flow that gets new members to book a first session.',
  fidelity: 'prototype',
  primaryUsers: 'Busy parents booking care on their phone',
  goals: ['Book a session in under 60 seconds'],
  primaryAction: 'Book a session',
  nonGoals: 'Payments; account settings', // strings are split on newlines and ";"
  tone: ['calm', 'warm'],
});

// Or step by step
const brief = buildBrief(answers);           // typed Brief, throws on invalid answers
const issues = lintBrief(brief);              // [{ level: 'warn' | 'info', field, message }]
const prompt = renderBrief(brief, 'prompt');  // 'markdown' | 'prompt' | 'json'

// Shareable links: answers live in the URL hash, so no server is involved
const url = shareUrl('https://example.com/brief', answers); // …#a=v1.eyJu…
const back = answersFromHash(new URL(url).hash);

// Point agent instruction files at a brief (Node only, so it has its own entry point)
import { linkBrief } from '@pixelatlarge/the-lowdown/link';
linkBrief({ brief: 'BRIEF.md' });             // [{ target, file, action: 'created' | 'added' | 'updated' | 'unchanged' }]
```

The main entry has no Node dependencies, so it runs in the browser as well as in Node.

### React component

The form on the [try-it page](https://pixelatlarge.github.io/the-lowdown/), ready to drop into your own tool. React 18+ is an optional peer dependency.

```tsx
import { LowdownForm } from '@pixelatlarge/the-lowdown/react';
import '@pixelatlarge/the-lowdown/react/styles.css'; // optional default theme

<LowdownForm
  quick
  onComplete={(brief, answers) => save(brief)}
  resultActions={({ output }) => <button onClick={() => send(output)}>Send to agent</button>}
/>
```

It asks one question at a time, shows the brief check before creating the brief, then offers Markdown, prompt and JSON tabs with copy and download. Props include `questions`, `quick`, `initialAnswers`, `startAtResult`, `onChange`, `onComplete`, `formats`, `renderOptions` and `resultActions`. Restyle it with the `--ld-*` CSS variables (`--ld-accent`, `--ld-font`, `--ld-radius`…), or skip the stylesheet and style the `ld-` classes yourself. `useBriefSession()` is exported too, for building a fully custom UI.

### Headless session (build your own UI)

`BriefSession` is a UI-agnostic state machine. Drive it from a React form, a chat agent, or a Slack bot.

```ts
import { BriefSession } from '@pixelatlarge/the-lowdown';

const session = new BriefSession({ quick: true });

while (!session.isComplete) {
  const q = session.current()!;           // { id, prompt, type, choices, example, help, required, ... }
  const input = await ask(q);              // your UI
  const result = session.answerText(input); // or session.answer(value), session.skip(), session.back()
  if (!result.ok) show(result.error);
}

const brief = session.toBrief();
```

`session.progress()` gives `{ index, total }`, and after `back()` the earlier answer is available via `session.draft(id)`.

### Custom questions

Add your own questions to any section, or a new one. Answers outside the built-in set land in `brief.extra` and render under their section.

```ts
import { BriefSession, DEFAULT_QUESTIONS, type Question } from '@pixelatlarge/the-lowdown';

const questions: Question[] = [
  ...DEFAULT_QUESTIONS,
  { id: 'hasBrand', section: 'brand', type: 'confirm', prompt: 'Is there an existing brand?' },
  {
    id: 'brandUrl',
    section: 'brand',
    type: 'text',
    prompt: 'Link to brand guidelines',
    when: (a) => a.hasBrand === true,
  },
];

const session = new BriefSession({ questions });
```

Question types: `text`, `longtext`, `list`, `select`, `multiselect`, `confirm`. Options include `required`, `quick`, `default`, `choices`, `allowOther`, `max`, `when` and `validate`.

### Exports

`BriefSession`, `buildBrief`, `createBrief`, `renderBrief`, `encodeAnswers`, `decodeAnswers`, `shareUrl`, `answersFromHash`, `toMarkdown`, `toPrompt`, `toJSON`, `lintBrief`, `parseInput`, `normalizeAnswer`, `validateAnswer`, `questionsToJSON`, `isBrief`, and the data behind the defaults: `DEFAULT_QUESTIONS`, `SECTIONS`, `TONE_GUIDANCE`, `TONE_TENSIONS`, `FIDELITY_GUIDANCE`, `ACCESSIBILITY_CHOICES`, `AGENT_INSTRUCTIONS`. All types are exported. `linkBrief` and `detectLinkTargets` come from `@pixelatlarge/the-lowdown/link`; `LowdownForm`, `useBriefSession` and `CopyButton` from `@pixelatlarge/the-lowdown/react`.

## Example output

```md
# Design brief: HealthHub onboarding

> A three-step onboarding flow that gets new members to book their first coaching session.

**Type:** Web app / product UI · **Fidelity:** Prototype

## Users

**Primary user:** Busy parents booking care between other tasks, mostly on their phone

## Goals

**Success looks like:**

- A new member books a session in under 60 seconds

**Primary action:** Book a session. Give it the strongest visual weight on the main screen.

**Out of scope (do not build):**

- Payments

## Tone

**Should feel:** Calm, Warm

- **Calm.** Do: Generous whitespace, muted palette, one clear focal point per screen, gentle motion. Avoid: Urgency cues, countdowns, red badges, dense layouts.
- **Warm.** Do: Second person ("you"), encouraging copy, soft warm hues… Avoid: Cold system language…

## Definition of done

- [ ] A new member books a session in under 60 seconds
- [ ] "Book a session" is the most prominent action on the main screen
- [ ] Nothing out of scope was built
- [ ] Assumptions are listed
```

## License

MIT
