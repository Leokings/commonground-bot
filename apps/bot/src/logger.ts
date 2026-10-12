import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  serializers: {
    error: (value: unknown) => value instanceof Error
      ? { name: value.name, message: value.message }
      : { message: "Operation failed; raw upstream data omitted" },
  },
  redact: {
    paths: [
      "token",
      "discordToken",
      "privateKey",
      "genlayerPrivateKey",
      "req.headers.authorization",
    ],
    censor: "[REDACTED]",
  },
});

