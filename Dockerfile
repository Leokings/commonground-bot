FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/bot/package.json apps/bot/package.json
COPY packages/core/package.json packages/core/package.json

RUN npm ci \
  --workspace @commonground/core \
  --workspace @commonground/bot \
  --include-workspace-root

COPY apps/bot apps/bot
COPY packages/core packages/core

RUN npm run build -w @commonground/core \
  && npm run build -w @commonground/bot

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "run", "bot:start"]
