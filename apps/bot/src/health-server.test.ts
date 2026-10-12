import type { AddressInfo } from "node:net";
import { request } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { startHealthServer } from "./health-server.js";

const servers: Awaited<ReturnType<typeof startHealthServer>>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

describe("health server", () => {
  it("rejects malformed URLs without crashing the bot", async () => {
    const server = await startHealthServer(0, () => ({ ready: true, network: "studionet", contractAddress: "0x22", release: "test" }));
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "http://[", method: "GET" }, (response) => {
        response.resume(); response.on("end", () => resolve(response.statusCode));
      });
      req.on("error", reject); req.end();
    });
    expect(status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
  });

  it("bounds public case reads so traffic cannot consume unlimited RPC requests", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    let started = 0;
    const server = await startHealthServer(0, () => ({ ready: true, network: "studionet", contractAddress: "0x22", release: "test" }), async () => {
      started += 1; await gate; return {};
    });
    servers.push(server);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cases/case-${"a".repeat(64)}`;
    const requests = Array.from({ length: 8 }, () => fetch(url));
    await vi.waitFor(() => expect(started).toBe(8));
    const overflow = await fetch(url);
    expect(overflow.status).toBe(503);
    expect(overflow.headers.get("retry-after")).toBe("5");
    finish();
    expect((await Promise.all(requests)).every((response) => response.status === 200)).toBe(true);
    expect((await fetch(url)).status).toBe(200);
  });
  it("reports Discord readiness without exposing secrets", async () => {
    let ready = false;
    const server = await startHealthServer(0, () => ({
      ready,
      network: "studionet",
      contractAddress: `0x${"22".repeat(20)}`,
      release: "test-release",
    }));
    servers.push(server);
    const port = (server.address() as AddressInfo).port;

    const starting = await fetch(`http://127.0.0.1:${port}/health`);
    expect(starting.status).toBe(503);
    expect(await starting.json()).toEqual({
      service: "commonground-bot",
      ready: false,
      network: "studionet",
      contractAddress: `0x${"22".repeat(20)}`,
      release: "test-release",
    });
    expect(starting.headers.get("access-control-allow-origin")).toBe("*");

    ready = true;
    const healthy = await fetch(`http://127.0.0.1:${port}/health`);
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toMatchObject({ ready: true });
  });

  it("serves only valid public case IDs through its read-only API", async () => {
    const reads: string[] = [];
    const validCase = `case-${"a".repeat(64)}`;
    const server = await startHealthServer(0, () => ({ ready: true, network: "studionet", contractAddress: `0x${"22".repeat(20)}`, release: "test" }), async (caseId) => {
      reads.push(caseId);
      return { caseId, decision: "allowed" };
    });
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/cases/${validCase}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ caseId: validCase, decision: "allowed" });
    const invalid = await fetch(`http://127.0.0.1:${port}/api/cases/not-a-case`);
    expect(invalid.status).toBe(404);
    expect(reads).toEqual([validCase]);
    const post = await fetch(`http://127.0.0.1:${port}/api/cases/${validCase}`, { method: "POST" });
    expect(post.status).toBe(405);
  });
});
