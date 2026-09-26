import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

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
});
