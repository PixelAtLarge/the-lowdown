# Changelog

Versioning rule: any breaking change to the brief format (`brief.json`, `schemaVersion`) is a major version.

## 0.2.0 (unreleased)

- **Try it in the browser:** https://pixelatlarge.github.io/the-lowdown/
- **React component:** `LowdownForm` and `useBriefSession` from `@pixelatlarge/the-lowdown/react`, with an optional default theme at `@pixelatlarge/the-lowdown/react/styles.css`. React 18+ is an optional peer dependency.
- **Share links:** `encodeAnswers`, `decodeAnswers`, `shareUrl` and `answersFromHash` keep answers in the URL hash, so no server is involved.
- **Link the brief:** `the-lowdown link`, plus `--link` and `--link-to` on `init` and `render`, add a "follow BRIEF.md" block to CLAUDE.md, AGENTS.md, Cursor rules or Copilot instructions.
- `linkBrief` lives at `@pixelatlarge/the-lowdown/link`, which keeps the main entry free of Node built-ins so it runs in the browser.
- `npm test` runs on Node 18 and 20.

## 0.1.0

- First release: guided Q&A CLI, Markdown / prompt / JSON output, brief checks, headless `BriefSession`, custom questions.
