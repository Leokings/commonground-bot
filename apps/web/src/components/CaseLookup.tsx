import { useEffect, useState } from "react";

const HEALTH_URL = "https://p01--commonground-bot--2tgdv5n7tzkj.code.run";
type CaseReceipt = {
  caseId: string; status: string; decision: string; revision: number;
  ruleId: string; ruleVersion: number; evidenceDigest?: string;
  enforcement?: { eligible?: boolean; enforce_after?: number };
  executorReceipt?: { outcome?: string; provenance?: string };
  history: Array<{ revision: number; kind: string; decision: string; analysis: string; decidedAt: string }>;
};

type Availability = "checking" | "ready" | "unavailable";
type Health = { protocol?: number; ready?: boolean };

export function CaseLookup() {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [caseId, setCaseId] = useState("");
  const [item, setItem] = useState<CaseReceipt | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${HEALTH_URL}/health`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Health returned ${response.status}`);
        return (await response.json()) as Health;
      })
      .then((health) => setAvailability(health.protocol === 2 && health.ready ? "ready" : "unavailable"))
      .catch(() => {
        if (!controller.signal.aborted) setAvailability("unavailable");
      });
    return () => controller.abort();
  }, []);

  async function lookup(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setItem(null);
    if (!/^case-[0-9a-f]{64}$/.test(caseId)) { setMessage("Enter the full case ID from CommonGround."); setBusy(false); return; }
    try {
      const response = await fetch(`${HEALTH_URL}/api/cases/${caseId}`, { cache: "no-store" });
      if (response.status === 404) throw new Error("No public v2 case was found for that ID.");
      if (!response.ok) throw new Error("The public case service could not be reached.");
      setItem(await response.json() as CaseReceipt);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Case lookup failed."); }
    finally { setBusy(false); }
  }

  if (availability !== "ready") {
    const status = availability === "checking"
      ? "Checking whether public case lookup is available…"
      : "Public API lookup is not live yet. In Discord, use /case status with the case ID to read the finalized on-chain result.";
    return <section className="section-shell case-lookup" aria-labelledby="case-lookup-title">
      <div className="eyebrow">PUBLIC CASE STATUS</div>
      <h2 id="case-lookup-title">Follow a finalized case.</h2>
      <p>Read case status and decision history without opening the reported message.</p>
      <p className="governance-status" role="status">{status}</p>
    </section>;
  }

  return <section className="section-shell case-lookup" aria-labelledby="case-lookup-title">
    <div className="eyebrow">PUBLIC CASE STATUS</div>
    <h2 id="case-lookup-title">Follow a case without a Discord login.</h2>
    <p>Enter a case ID to read the public decision history and the executor’s reported action.</p>
    <form onSubmit={(event) => void lookup(event)}><label htmlFor="public-case-id">Case ID</label><div><input id="public-case-id" autoComplete="off" spellCheck={false} value={caseId} onChange={(event) => setCaseId(event.target.value.trim())} placeholder="case-…" /><button className="button button-primary" disabled={busy}>{busy ? "Looking up…" : "Check case"}</button></div></form>
    {message && <p className="governance-status" role="status">{message}</p>}
    {item && <div className="case-result" aria-live="polite"><div className="case-summary"><span className="status-pill">{item.status}</span><strong>Decision: {item.decision}</strong><span>Revision {item.revision} · {item.ruleId} v{item.ruleVersion}</span></div><ol>{item.history.map((record) => <li key={record.revision}><strong>Revision {record.revision}: {record.decision}</strong><span>{record.kind} · {new Date(record.decidedAt).toLocaleString()}</span><p>{record.analysis}</p></li>)}</ol><small>Discord action: {item.executorReceipt?.outcome ?? "not recorded"}. An executor receipt reports what the bot says it did; it does not independently prove a Discord action.</small></div>}
  </section>;
}
