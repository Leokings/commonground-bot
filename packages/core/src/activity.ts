import type { ActivitySnapshot, MessageSample } from "./types.js";

export class ActivityTracker {
  readonly #messages = new Map<string, MessageSample[]>();

  constructor(private readonly retentionMs = 60 * 60 * 1_000) {}

  snapshot(message: MessageSample): ActivitySnapshot {
    this.prune(message.createdAt);
    return {
      authorMessages: [
        ...(this.#messages.get(this.key(message.guildId, message.authorId)) ?? []),
      ],
    };
  }

  record(message: MessageSample): void {
    this.prune(message.createdAt);
    const key = this.key(message.guildId, message.authorId);
    const current = this.#messages.get(key) ?? [];
    current.push(message);
    this.#messages.set(key, current);
  }

  private key(guildId: string, authorId: string): string {
    return `${guildId}:${authorId}`;
  }

  private prune(now: number): void {
    const cutoff = now - this.retentionMs;
    for (const [key, samples] of this.#messages.entries()) {
      const remaining = samples.filter((sample) => sample.createdAt >= cutoff);
      if (remaining.length === 0) {
        this.#messages.delete(key);
      } else {
        this.#messages.set(key, remaining);
      }
    }
  }
}

