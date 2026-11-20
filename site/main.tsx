import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CopyButton, LowdownForm } from '../src/react';
import { answersFromHash, shareUrl } from '../src/share';
import type { Answers } from '../src/types';
import '../src/react.css';
import './styles.css';

const REPO = 'https://github.com/PixelAtLarge/the-lowdown';
const NPM = 'https://www.npmjs.com/package/@pixelatlarge/the-lowdown';
const VIDEO = 'https://github.com/user-attachments/assets/664fe32c-e3d6-4107-a590-d4331334f937';
const INSTALL = 'npx @pixelatlarge/the-lowdown';

function Mark({ size = 40 }: { size?: number }) {
  return <img src={`${import.meta.env.BASE_URL}mark.svg`} width={size} height={Math.round(size * 0.87)} alt="" />;
}

function ShareButton({ answers }: { answers: Answers }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="ld-btn"
      onClick={async () => {
        const url = shareUrl(location.href.split('#')[0]!, answers);
        history.replaceState(null, '', url);
        try {
          await navigator.clipboard.writeText(url);
          setState('copied');
        } catch {
          setState('failed');
        }
        setTimeout(() => setState('idle'), 2200);
      }}
    >
      <span aria-live="polite">{state === 'copied' ? 'Link copied' : state === 'failed' ? 'Link is in the address bar' : 'Copy share link'}</span>
    </button>
  );
}

function TryIt() {
  const shared = useMemo(() => answersFromHash(location.hash), []);
  const [quick, setQuick] = useState(true);
  const [done, setDone] = useState(Boolean(shared));

  return (
    <section id="try" className="try">
      <div className="try-head">
        <div>
          <span className="chip">Try it</span>
          <h2>Write a brief in your browser</h2>
          <p className="muted">Same questions as the command line. Nothing leaves your browser unless you share the link.</p>
        </div>
        {!shared && (
          <div className="seg" role="group" aria-label="Question set">
            <button type="button" aria-pressed={quick} onClick={() => setQuick(true)}>Quick · 11</button>
            <button type="button" aria-pressed={!quick} onClick={() => setQuick(false)}>Full · 17</button>
          </div>
        )}
      </div>
      {shared && <p className="note">You opened a shared brief. Edit any answer with “Back to review”, or start your own.</p>}
      <LowdownForm
        key={quick ? 'quick' : 'full'}
        className="lowdown"
        quick={quick}
        initialAnswers={shared}
        startAtResult={Boolean(shared)}
        onComplete={() => setDone(true)}
        resultActions={({ answers }) => <ShareButton answers={answers} />}
      />
      {done && (
        <div className="next">
          <h3>Then hand it to your agent</h3>
          <ol>
            <li>Save the Markdown as <code>BRIEF.md</code> in your project.</li>
            <li>
              Run <code>npx @pixelatlarge/the-lowdown link</code>. It adds a “follow BRIEF.md” block to your CLAUDE.md,
              AGENTS.md or Cursor rules.
            </li>
          </ol>
        </div>
      )}
    </section>
  );
}

const STEPS = [
  { n: '01', title: 'Ask', body: 'Who it’s for, what success looks like, what’s out of scope: the questions a good designer asks first.' },
  { n: '02', title: 'Push back', body: 'Weak answers get flagged. “Everyone” isn’t a user, and “intuitive” isn’t a goal.' },
  { n: '03', title: 'Tone and fidelity', body: 'Three tone words become concrete do’s and don’ts. Sketch, prototype or production sets the bar.' },
  { n: '04', title: 'Brief', body: 'Hard requirements, a do-not-build list and a definition of done, in Markdown, a tagged prompt or JSON.' },
];

function App() {
  return (
    <>
      <header className="top">
        <a className="brand" href="#top" aria-label="The Lowdown home"><Mark size={38} /><span>The Lowdown</span></a>
        <nav>
          <a href="#try">Try it</a>
          <a href={REPO}>GitHub</a>
          <a href={NPM}>npm</a>
        </nav>
      </header>

      <main id="top">
        <section className="hero">
          <Mark size={120} />
          <h1>Give your AI agent the lowdown.</h1>
          <p className="lead">
            A few minutes of the questions a good designer would ask. Out comes a design brief Claude Code, Cursor or any
            agent can actually follow.
          </p>
          <div className="install">
            <code><span className="prompt">$</span> {INSTALL}</code>
            <CopyButton text={INSTALL} label="Copy" className="copy" />
          </div>
          <p className="flow">a few questions → a clear brief → the right build</p>
          <a className="cta" href="#try">Try it in your browser ↓</a>
        </section>

        <section className="video" aria-label="Explainer video">
          <div className="win">
            <div className="bar"><i /><i /><i /><span>the-lowdown-explainer.mp4</span></div>
            <video controls preload="none" poster={`${import.meta.env.BASE_URL}og.png`} playsInline>
              <source src={VIDEO} type="video/mp4" />
              <a href={VIDEO}>Watch the explainer</a>
            </video>
          </div>
        </section>

        <TryIt />

        <section className="how" aria-labelledby="how-h">
          <span className="chip">How it works</span>
          <h2 id="how-h">Agents guess. Briefs don’t.</h2>
          <p className="muted narrow">
            Left to guess, agents fill every gap with defaults: everyone is the user, everything is in scope, and it all looks
            “clean and modern.” The Lowdown closes those gaps before the first line of code.
          </p>
          <div className="steps">
            {STEPS.map((s) => (
              <article key={s.n} className="step">
                <span className="n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="use" aria-labelledby="use-h">
          <span className="chip">Use it anywhere</span>
          <h2 id="use-h">Terminal, React or your agent</h2>
          <div className="cards">
            <article>
              <h3>Command line</h3>
              <pre><code>{`npx @pixelatlarge/the-lowdown --link`}</code></pre>
              <p>Runs the interview, writes BRIEF.md and points your agent instruction files at it.</p>
            </article>
            <article>
              <h3>React</h3>
              <pre><code>{`import { LowdownForm } from
  '@pixelatlarge/the-lowdown/react';

<LowdownForm onComplete={save} />`}</code></pre>
              <p>The form on this page, ready to drop into your own tool.</p>
            </article>
            <article>
              <h3>Let the agent ask</h3>
              <pre><code>{`npx @pixelatlarge/the-lowdown questions`}</code></pre>
              <p>Prints the questions with interview instructions, so an agent can run the Q&amp;A in chat.</p>
            </article>
          </div>
        </section>
      </main>

      <footer>
        <p>
          Made by <a href="https://annapoirier.com">Anna Poirier</a>. MIT licensed, no tracking.
          A sibling of <a href="https://pixelatlarge.github.io/peanut-gallery/">Peanut Gallery</a>.
        </p>
        <p><a href={REPO}>GitHub</a> · <a href={NPM}>npm</a></p>
      </footer>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
