import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
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

