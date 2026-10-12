import { createServer, type Server } from "node:http";

export interface HealthSnapshot {
  ready: boolean;
  network: string;
  contractAddress: string;
  release: string;
  protocol?: number;
  registryAddress?: string;
  ledgerAddress?: string;
  relayerAddress?: string;
}

export type PublicCaseReader = (caseId: string) => Promise<unknown | null>;

export function startHealthServer(
  port: number,
  getSnapshot: () => HealthSnapshot,
  readPublicCase?: PublicCaseReader,
): Promise<Server> {
  let activeCaseReads = 0;
  const server = createServer((request, response) => {
    const snapshot = getSnapshot();
    const body = JSON.stringify({
      service: "commonground-bot",
      ...snapshot,
    });

    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("access-control-allow-origin", "*");

    if (request.method !== "GET") {
      response.statusCode = 405;
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    if (request.url === "/health") {
      response.statusCode = snapshot.ready ? 200 : 503;
      response.end(body);
      return;
    }

    if (request.url === "/") {
      response.statusCode = 200;
      response.end(body);
      return;
    }

    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: "invalid_request_url" }));
      return;
    }
    const caseMatch = /^\/api\/cases\/(case-[0-9a-f]{64})$/u.exec(pathname);
    if (caseMatch && readPublicCase) {
      if (activeCaseReads >= 8) {
        response.statusCode = 503;
        response.setHeader("retry-after", "5");
        response.end(JSON.stringify({ error: "case_service_busy" }));
        return;
      }
      activeCaseReads += 1;
      void Promise.resolve().then(() => readPublicCase(caseMatch[1]!)).then((item) => {
        response.statusCode = item === null ? 404 : 200;
        response.end(JSON.stringify(item ?? { error: "case_not_found" }));
      }).catch(() => {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: "case_service_unavailable" }));
      }).finally(() => { activeCaseReads -= 1; });
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", onError);
      resolve(server);
    });
  });
}
