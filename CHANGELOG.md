# Changelog

Versioning rule: any breaking change to the brief format (`brief.json`, `schemaVersion`) is a major version.

## 0.2.0 (unreleased)

- **Try it in the browser:** https://pixelatlarge.github.io/the-lowdown/
- **React component:** `LowdownForm` and `useBriefSession` from `@pixelatlarge/the-lowdown/react`, with an optional default theme at `@pixelatlarge/the-lowdown/react/styles.css`. React 18+ is an optional peer dependency.
- **Share links:** `encodeAnswers`, `decodeAnswers`, `shareUrl` and `answersFromHash` keep answers in the URL hash, so no server is involved.
- **Link the brief:** `the-lowdown link`, plus `--link` and `--link-to` on `init` and `render`, add a "follow BRIEF.md" block to CLAUDE.md, AGENTS.md, Cursor rules or Copilot instructions.
- `linkBrief` lives at `@pixelatlarge/the-lowdown/link`, which keeps the main entry free of Node built-ins so it runs in the browser.
- `npm test` runs on Node 18 and 20.
- **Questions by project type:** web apps, marketing sites, mobile apps, dashboards, component libraries and content each get two or three questions of their own, asked only when that kind is picked. They render under "Project specifics".
- **More of what a designer would ask:** secondary users, a goal ranking (when there are two or more goals), whether real content exists, brand asset links, things that apply everywhere (dark mode, localization…), and what to borrow from each reference.
- **New question types:** `scale` and `rank`. Questions can also carry a serializable `condition`.
- **Arrow-key menus** in the terminal for choices, scales and rankings, with no new dependencies. `--plain` (and piped input) keeps the numbered prompts.
- **Team config:** `.lowdownrc.json` (or `--config`) sets defaults, fixed answers, skipped questions, extra questions, rewording and section titles, which is also how to translate the interview. `applyConfig` and `validateConfig` are exported.
- New brief checks: unranked goals, a marketing page without a conversion goal, a dashboard without key metrics, references with nothing to borrow.
- **Edit a brief by hand and keep going:** every command reads `BRIEF.md` back (`readBrief`, `parseMarkdownBrief`). Markdown files written by the CLI get a short YAML header; `--no-frontmatter` leaves it out.
- **`the-lowdown edit`** re-runs the Q&A with the current answers prefilled, and `--only goals,tone` re-asks just those sections. It shows what changed before writing.
- **`the-lowdown diff`** compares two briefs field by field and exits 1 when they differ (`diffBriefs`).
- **HTML export** (`-f html`, `toHTML`): a print-ready page for PDF and Google Docs. The React form gets a "Print or save as PDF" button.
- **Brief strength score** (`scoreBrief`, `scoreTips`) in the review step, in `lint` and in the React form.
- **Your own tone words:** `tones` in the config adds choices with do/avoid guidance; the React form takes `toneGuidance`.
- More brief checks: a platform the stack can't build (iOS with a web stack, or the reverse), production fidelity without the states to build, more than five success criteria, and an item that is both a must and out of scope.
- Brief JSON stays `schemaVersion: 1`: new fields are optional, and briefs saved earlier still render.

## 0.1.0

- First release: guided Q&A CLI, Markdown / prompt / JSON output, brief checks, headless `BriefSession`, custom questions.
