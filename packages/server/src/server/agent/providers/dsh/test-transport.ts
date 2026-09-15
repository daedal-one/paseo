import type { DshStreamObserver, DshSubscription, DshTransport } from "./connection.js";

export interface DshTestRequest {
  endpoint: string;
  args: Record<string, unknown>;
}

/** In-memory port for provider behavior tests; it does not emulate an HTTP server. */
export class DshTestTransport implements DshTransport {
  readonly requests: DshTestRequest[] = [];
  readonly streams = new Map<string, DshStreamObserver>();
  readonly closedStreams: string[] = [];
  respond: (request: DshTestRequest) => unknown = () => ({});
  initial: (endpoint: string) => unknown = (endpoint) =>
    endpoint === "$events" ? { type: "ready", clientId: "client-1" } : null;
  opened: (endpoint: string) => void = () => {};

  async request(endpoint: string, args: Record<string, unknown>): Promise<unknown> {
    const request = { endpoint, args };
    this.requests.push(request);
    return this.respond(request);
  }

  async open(
    endpoint: string,
    _args: Record<string, unknown>,
    observer: DshStreamObserver,
  ): Promise<DshSubscription> {
    this.streams.set(endpoint, observer);
    queueMicrotask(() => {
      const value = this.initial(endpoint);
      if (value !== null) observer.value(value);
      this.opened(endpoint);
    });
    return {
      close: () => {
        this.closedStreams.push(endpoint);
        this.streams.delete(endpoint);
      },
    };
  }

  send(endpoint: string, value: unknown): void {
    const observer = this.streams.get(endpoint);
    if (!observer) throw new Error(`No open ${endpoint} stream`);
    observer.value(value);
  }

  async close(): Promise<void> {
    this.streams.clear();
  }
}
