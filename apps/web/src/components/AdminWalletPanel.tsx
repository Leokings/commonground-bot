import { useEffect, useState } from "react";

const HEALTH_URL = "https://p01--commonground-bot--2tgdv5n7tzkj.code.run/health";
const ZERO = "0x0000000000000000000000000000000000000000" as const;
type Provider = { request(args: { method: string; params?: readonly unknown[] }): Promise<unknown> };
type Deployment = { protocol?: number; registryAddress?: string; relayerAddress?: string; ready?: boolean };
declare global { interface Window { ethereum?: Provider } }

type Availability = "checking" | "ready" | "unavailable";

async function guildKey(discordId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`guild:${discordId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function AdminWalletPanel() {
  const [discordId, setDiscordId] = useState("");
  const [duration, setDuration] = useState("604800");
  const [wallet, setWallet] = useState("");
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [availability, setAvailability] = useState<Availability>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(HEALTH_URL, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Health returned ${response.status}`);
        return (await response.json()) as Deployment;
      })
      .then((current) => {
        setDeployment(current);
        setAvailability(current.ready === true && current.protocol === 2 && Boolean(current.registryAddress && current.relayerAddress) ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailability("unavailable");
      });
    return () => controller.abort();
  }, []);

  async function connect() {
    setBusy(true); setMessage("");
    try {
      if (availability !== "ready" || !deployment?.registryAddress || !deployment.relayerAddress) {
        throw new Error("The v2 governance contracts are not live yet. No wallet connection is needed for the current Discord flow.");
      }
      if (!window.ethereum) throw new Error("Install or open an EIP-1193 wallet extension first.");
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts[0]) throw new Error("The wallet did not return an account.");
      setWallet(accounts[0]);
      setMessage("Wallet connected. Enter the Discord server ID to continue.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Wallet connection failed."); }
    finally { setBusy(false); }
  }

  if (availability !== "ready") {
    const status = availability === "checking"
      ? "Checking the hosted contract configuration…"
      : "Not live yet · waiting for the v2 governance contracts";
    return <section className="governance-panel" aria-labelledby="governance-title">
      <div className="governance-copy">
        <div className="eyebrow">UPCOMING SERVER OWNER CONTROL</div>
        <h2 id="governance-title">Temporary rule-edit delegation</h2>
        <p>This wallet control is unavailable until protocol v2 is deployed. The current Discord report and rule commands continue to work; you do not need to connect a wallet for them.</p>
      </div>
      <div className="governance-form">
        <p className="governance-status" role="status">{status}</p>
      </div>
    </section>;
  }

  async function delegate(revoke: boolean) {
    setBusy(true); setMessage(""); setTxHash("");
    try {
      const provider = window.ethereum;
      if (!wallet || !deployment?.registryAddress || !deployment.relayerAddress || !provider) throw new Error("Connect an EIP-1193 wallet first.");
      if (!/^\d{5,25}$/.test(discordId)) throw new Error("Enter the numeric Discord server ID.");
      const [{ createClient }, { studionet }] = await Promise.all([
        import("genlayer-js"),
        import("genlayer-js/chains"),
      ]);
      const client = createClient({ chain: studionet as never, account: wallet as `0x${string}`, provider: provider as never });
      await client.connect("studionet");
      const expiry = revoke ? 0 : Math.floor(Date.now() / 1000) + Number(duration);
      const hash = await client.writeContract({
        address: deployment.registryAddress as `0x${string}`,
        functionName: "set_roles",
        args: [await guildKey(discordId), deployment.relayerAddress as `0x${string}`, revoke ? ZERO : deployment.relayerAddress as `0x${string}`, expiry],
        value: 0n,
      });
      setTxHash(String(hash));
      setMessage(revoke ? "Revocation submitted. It takes effect when the transaction finalizes." : "Delegation submitted. It takes effect when the transaction finalizes.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The wallet transaction failed."); }
    finally { setBusy(false); }
  }

  return <section className="governance-panel" aria-labelledby="governance-title">
    <div className="governance-copy">
      <div className="eyebrow">SERVER OWNER CONTROLS</div>
      <h2 id="governance-title">Approve rule edits by the bot for a limited time.</h2>
      <p>Connect the wallet that owns this server’s rules. The bot wallet can edit rules for up to seven days after you approve it. Its separate permission to submit cases stays active. You can revoke editing access any time.</p>
      <button className="button button-dark" type="button" disabled={busy} onClick={() => void connect()}>{wallet ? `Connected · ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "Connect admin wallet"}</button>
    </div>
    <div className="governance-form">
      <label>Discord server ID<input inputMode="numeric" autoComplete="off" value={discordId} onChange={(event) => setDiscordId(event.target.value)} placeholder="Right click server → Copy Server ID" /></label>
      {deployment?.relayerAddress && <label>CommonGround bot wallet<input readOnly value={deployment.relayerAddress} /></label>}
      <label>Access length<select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="86400">1 day</option><option value="259200">3 days</option><option value="604800">7 days</option></select></label>
      <div className="governance-actions"><button className="button button-primary" type="button" disabled={busy || !wallet} onClick={() => void delegate(false)}>Grant editing access</button><button className="button button-paper" type="button" disabled={busy || !wallet} onClick={() => void delegate(true)}>Revoke access</button></div>
      {message && <p className="governance-status" role="status">{message}</p>}
      {txHash && <a href={`https://explorer-studio.genlayer.com/tx/${txHash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}
      <small>Wallet writes are signed by you on StudioNet. The server ID is hashed in your browser before it is sent to GenLayer.</small>
    </div>
  </section>;
}
