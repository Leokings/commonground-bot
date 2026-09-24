import { createServer, type Server } from "node:http";

export interface HealthSnapshot {
  ready: boolean;
  network: string;
}

export function startHealthServer(
  port: number,
  getSnapshot: () => HealthSnapshot,
): Promise<Server> {
  const server = createServer((request, response) => {
    const snapshot = getSnapshot();
    const body = JSON.stringify({
      service: "commonground-bot",
      ...snapshot,
    });

    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");

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
