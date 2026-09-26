import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { ValidatorCanvas } from "./components/ValidatorCanvas";

const WalkthroughPlayer = lazy(() => import("./components/WalkthroughPlayer"));

const CLIENT_ID = "1552600187556462652";
const INSTALL_URL = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=76800&integration_type=0&scope=bot%20applications.commands`;
const GITHUB_URL = "https://github.com/Leokings/commonground-bot";
const CONTRACT_ADDRESS = "0xf8145e93E2Ab9Ea40bA39707A6Ae4b1663a88A90";
const CONTRACT_URL = `https://explorer-studio.genlayer.com/address/${CONTRACT_ADDRESS}`;
const HEALTH_URL =
  "https://p01--commonground-bot--2tgdv5n7tzkj.code.run/health";
const EVIDENCE = [
  {
    label: "Member report opened",
    detail: "The reported Discord message and bounded context were written on-chain.",
    hash: "0x71232b…4a248",
    href: "https://explorer-studio.genlayer.com/tx/0x71232b8447b3f12f1d3c98c5a0c80b9bc1991c0b6979368510563be39894a248",
  },
  {
    label: "Decision finalized",
    detail: "GenLayer validators returned an allowed decision for the positive-context test.",
    hash: "0x28dd6e…f4edf",
    href: "https://explorer-studio.genlayer.com/tx/0x28dd6e26d304fbfdc850a1f686c2c04f15e093e212c4bedbe2a57c96abbf4edf",
  },
] as const;

type Health = {
  service: string;
  ready: boolean;
  network: string;
  contractAddress?: string;
  release?: string;
};

const samples = [
  {
    id: "praise",
    message: "Fuck, this is so great!",
    context: "Replying to: “I finally shipped the feature.”",
    route: "Context-aware profanity",
    result: "Send to GenLayer · likely allowed in this praise context",
    tone: "mint",
  },
  {
    id: "insult",
    message: "You are fucking stupid.",
    context: "Directed at another member during an argument.",
    route: "Context-aware profanity",
    result: "Send to GenLayer · likely violation as targeted abuse",
    tone: "coral",
  },
  {
    id: "invite",
    message: "Join us at discord.gg/example",
    context: "No administrator approval is present.",
    route: "No unsolicited Discord invites",
    result: "Deterministic match · apply the configured action",
    tone: "violet",
  },
] as const;

function ArrowIcon() {
  return <span aria-hidden="true">↗</span>;
}

function ExternalLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function LiveStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    fetch(HEALTH_URL, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Health returned ${response.status}`);
        return (await response.json()) as Health;
      })
      .then((value) => setHealth(value))
      .catch(() => setFailed(true))
      .finally(() => window.clearTimeout(timer));
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  if (health?.ready) {
    return (
      <ExternalLink href={HEALTH_URL} className="status-pill status-live">
        <span className="status-dot" /> Bot live · StudioNet <ArrowIcon />
      </ExternalLink>
    );
  }
  if (failed) {
    return (
      <ExternalLink href={HEALTH_URL} className="status-pill">
        Check hosted bot <ArrowIcon />
      </ExternalLink>
    );
  }
  return <span className="status-pill">Checking hosted bot…</span>;
}

function Logo() {
  return (
    <a className="brand" href="#top" aria-label="CommonGround home">
      <img src="/logo.svg" alt="" />
      <span>CommonGround</span>
    </a>
  );
}

export function App() {
  const [sampleId, setSampleId] = useState<(typeof samples)[number]["id"]>(
    "praise",
  );
  const sample = useMemo(
    () => samples.find((item) => item.id === sampleId) ?? samples[0],
    [sampleId],
  );

  return (
    <>
      <header className="site-header" id="top">
        <Logo />
        <nav aria-label="Primary navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#try-it">Try the flow</a>
          <a href="#evidence">Evidence</a>
          <ExternalLink href={GITHUB_URL}>GitHub</ExternalLink>
        </nav>
        <ExternalLink href={INSTALL_URL} className="button button-small button-dark">
          Add to Discord <ArrowIcon />
        </ExternalLink>
      </header>

      <main>
        <section className="hero section-shell" aria-labelledby="hero-title">
          <div className="hero-copy">
            <div className="eyebrow">MEMBER-TRIGGERED · GENLAYER-VERIFIED</div>
            <h1 id="hero-title">
              Community rules,
              <span className="scribble"> fairly applied.</span>
            </h1>
            <p className="hero-lede">
              CommonGround reviews only the Discord messages people report. It
              chooses the right rule, sends contextual disputes to GenLayer, and
              carries the finalized decision back to the server.
            </p>
            <div className="hero-actions">
              <ExternalLink href={INSTALL_URL} className="button button-primary">
                Add the bot — free <ArrowIcon />
              </ExternalLink>
              <a href="#try-it" className="button button-paper">
                See a report flow ↓
              </a>
            </div>
            <div className="trust-row" aria-label="Product highlights">
              <span>✓ No blanket message scanning</span>
              <span>✓ 6 editable starter rules</span>
              <span>✓ On-chain case history</span>
            </div>
          </div>

          <div className="hero-visual" aria-label="CommonGround network illustration">
            <ValidatorCanvas />
            <div className="floating-card report-card">
              <span className="avatar coral">M</span>
              <div>
                <small>REPORTED MESSAGE</small>
                <strong>“You are …”</strong>
              </div>
              <span className="flag">!</span>
            </div>
            <div className="floating-card rule-card">
              <span className="avatar mint">R</span>
              <div>
                <small>RULE MATCH</small>
                <strong>Targeted abuse</strong>
              </div>
            </div>
            <div className="validator-orbit">
              <span>✦</span>
              <strong>GenLayer</strong>
              <small>context review</small>
            </div>
            <div className="decision-stamp">FINALIZED ✓</div>
          </div>
        </section>

        <section className="proof-strip" aria-label="Live deployment status">
          <LiveStatus />
          <ExternalLink href={CONTRACT_URL} className="strip-link">
            Contract {CONTRACT_ADDRESS.slice(0, 8)}…{CONTRACT_ADDRESS.slice(-6)}
            <ArrowIcon />
          </ExternalLink>
          <ExternalLink href={GITHUB_URL} className="strip-link">
            Open-source repository <ArrowIcon />
          </ExternalLink>
        </section>

        <section className="section-shell section-space" id="how-it-works">
          <div className="section-heading split-heading">
            <div>
              <div className="eyebrow">THE WHOLE JOURNEY</div>
              <h2>One report. Four clear steps.</h2>
            </div>
            <p>
              The bot is a moderator people can call when needed—not a watcher
              reading every conversation.
            </p>
          </div>
          <div className="remotion-frame">
            <Suspense fallback={<div className="player-loading">Loading the walkthrough…</div>}>
              <WalkthroughPlayer />
            </Suspense>
          </div>
          <p className="media-caption">
            Interactive product walkthrough · built with Remotion
          </p>
        </section>

        <section className="demo-band" id="try-it">
          <div className="section-shell demo-grid">
            <div className="demo-copy">
              <div className="eyebrow">CONTEXT CHANGES MEANING</div>
              <h2>Words alone are not the verdict.</h2>
              <p>
                Pick an example to see how CommonGround routes a member report.
                This preview explains the path; it does not send a transaction.
              </p>
              <div className="sample-tabs" role="tablist" aria-label="Example messages">
                {samples.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={sampleId === item.id}
                    className={sampleId === item.id ? "active" : ""}
                    onClick={() => setSampleId(item.id)}
                  >
                    {item.id === "praise"
                      ? "Praise"
                      : item.id === "insult"
                        ? "Insult"
                        : "Invite"}
                  </button>
                ))}
              </div>
            </div>
            <div className={`message-lab tone-${sample.tone}`}>
              <div className="lab-topline">
                <span>RULE-ROUTING PREVIEW</span>
                <span className="lab-light" />
              </div>
              <div className="discord-message">
                <span className="avatar violet">A</span>
                <div>
                  <strong>community-member</strong>
                  <p>{sample.message}</p>
                </div>
              </div>
              <div className="context-note">↳ {sample.context}</div>
              <div className="route-result">
                <span>Selected rule</span>
                <strong>{sample.route}</strong>
                <p>{sample.result}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="section-shell section-space setup-section">
          <div className="section-heading centered">
            <div className="eyebrow">FIRST-TIME SETUP</div>
            <h2>From install to first fair review.</h2>
            <p>An administrator sets up the server once. Every member can report.</p>
          </div>
          <ol className="setup-cards">
            <li>
              <span className="step-number">1</span>
              <div className="step-icon coral">＋</div>
              <h3>Add CommonGround</h3>
              <p>Install the bot with the four permissions it needs to read, reply, and moderate.</p>
              <ExternalLink href={INSTALL_URL} className="text-link">
                Open Discord install <ArrowIcon />
              </ExternalLink>
            </li>
            <li>
              <span className="step-number">2</span>
              <div className="step-icon mint">/</div>
              <h3>Run one command</h3>
              <p>Use the admin command to register the server and install the editable starter pack.</p>
              <code>/rule setup</code>
            </li>
            <li>
              <span className="step-number">3</span>
              <div className="step-icon violet">@</div>
              <h3>Report by replying</h3>
              <p>Reply to a public message. CommonGround selects the rule automatically.</p>
              <code>@CommonGround report</code>
            </li>
          </ol>
          <div className="privacy-note">
            <span className="privacy-icon">◉</span>
            <div>
              <strong>Private by default where it matters.</strong>
              <p>
                CommonGround ignores unreported messages and rejects private channels.
                Only a bounded, pseudonymized conversation snapshot accompanies a contextual case.
              </p>
            </div>
          </div>
        </section>

        <section className="evidence-band" id="evidence">
          <div className="section-shell">
            <div className="section-heading split-heading light-heading">
              <div>
                <div className="eyebrow">REVIEWER EVIDENCE</div>
                <h2>Follow the live trail.</h2>
              </div>
              <p>
                These are explorer-backed transactions from a real member report,
                followed by the finalized GenLayer decision.
              </p>
            </div>
            <div className="evidence-grid">
              {EVIDENCE.map((item, index) => (
                <ExternalLink key={item.href} href={item.href} className="evidence-card">
                  <span className="evidence-index">0{index + 1}</span>
                  <div>
                    <small>{item.hash}</small>
                    <h3>{item.label}</h3>
                    <p>{item.detail}</p>
                  </div>
                  <span className="evidence-arrow">↗</span>
                </ExternalLink>
              ))}
              <ExternalLink href={CONTRACT_URL} className="evidence-card contract-card">
                <span className="evidence-index">03</span>
                <div>
                  <small>STUDIONET CONTRACT</small>
                  <h3>Read the state</h3>
                  <p>Inspect the deployed contract, rule versions, and transaction history.</p>
                </div>
                <span className="evidence-arrow">↗</span>
              </ExternalLink>
            </div>
          </div>
        </section>

        <section className="section-shell final-cta">
          <div>
            <div className="eyebrow">A MODERATOR YOUR COMMUNITY CAN CALL</div>
            <h2>Keep the rules visible. Keep the decisions verifiable.</h2>
          </div>
          <div className="final-actions">
            <ExternalLink href={INSTALL_URL} className="button button-primary">
              Add to Discord <ArrowIcon />
            </ExternalLink>
            <ExternalLink href={GITHUB_URL} className="button button-paper">
              View source <ArrowIcon />
            </ExternalLink>
          </div>
        </section>
      </main>

      <footer>
        <Logo />
        <p>Member-driven moderation, backed by GenLayer.</p>
        <div>
          <ExternalLink href={CONTRACT_URL}>Contract</ExternalLink>
          <ExternalLink href={GITHUB_URL}>GitHub</ExternalLink>
          <ExternalLink href={HEALTH_URL}>Bot status</ExternalLink>
        </div>
      </footer>
    </>
  );
}
