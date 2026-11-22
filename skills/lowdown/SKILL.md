---
name: lowdown
description: Write or update a design brief (BRIEF.md) by interviewing the user about users, goals, constraints and tone, then check finished work against it. Use when starting UI or design work without a brief, when the user asks for a design brief, or before calling design work done.
argument-hint: "[update | check | <path to a PRD or README>]"
allowed-tools: Bash(npx @pixelatlarge/the-lowdown *), Bash(npx the-lowdown *), Bash(the-lowdown *)
---

# the-lowdown: design brief interview

You run a short interview with the user and write `BRIEF.md`, a design brief that you and other agents follow for design work in this project. Arguments: $ARGUMENTS

If the-lowdown's MCP tools are available (`get_questions`, `get_brief`, `update_brief`, `check_against_brief`), use them in place of the commands below. Otherwise run the CLI with `npx @pixelatlarge/the-lowdown` (shortened to `lowdown` below).

## Pick the mode

- **"check"**: run `lowdown check` and follow the checklist it prints. Answer every item pass, fail or unsure with evidence, fix the fails, check again, then report. If the user gave a preview URL, add `--url <url>`.
- **A file path or URL**: use it as source material. Run `lowdown answers --from <path> -o .lowdown/draft.json` to get drafted answers, then confirm each one with the user during the interview instead of asking from scratch.
- **BRIEF.md already exists** (or "update"): don't start over. Run `lowdown answers BRIEF.md` to get the current answers, ask the user what changed, and re-ask only those questions.
- **Otherwise**: run the full interview.

## Interview

1. Run `lowdown questions` to get the questions, sections and rules as JSON. It already includes the team's `.lowdownrc.json`, if there is one.
2. Ask **one question at a time**, in order, in plain conversational language. Use the prompt wording, give the example as a hint, and offer the choices for select and multiselect questions (as a multiple-choice question if your tools support it).
3. Required questions need an answer. The user can skip anything else. Skip questions whose `condition` doesn't match the answers so far.
4. If an answer is too vague to design from ("Everyone", a goal that's only an adjective like "intuitive", several primary actions), ask **one** short follow-up before moving on.
5. Don't invent answers, and don't fill in what the user didn't say.

## Write the brief

1. Save the answers, keyed by question id, to `.lowdown/answers.json`.
2. Run `lowdown render .lowdown/answers.json -o BRIEF.md`.
3. Run `lowdown lint BRIEF.md`. Read the warnings and the strength score to the user and offer to tighten the weak answers; if they agree, update the answers and render again.
4. Run `lowdown link` so CLAUDE.md or AGENTS.md points at the brief.
5. Tell the user where the brief is, in one or two sentences.

## While building

Treat "Must" items as hard requirements and "Out of scope" as do-not-build. Before you say design work is done, run `lowdown check` and work through it.
