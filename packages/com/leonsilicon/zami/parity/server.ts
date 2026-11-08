// The runner's end of the agents' WebSocket: one agent per side, replaced whenever the app
// reloads and connects again.
import { WebSocketServer, type WebSocket } from "ws";
import type { AgentMessage, Command, Side } from "#protocol";

export type Hello = Extract<AgentMessage, { type: "hello" }>;

interface Connection {
  socket: WebSocket;
  hello: Hello;
  /** Counts connections, so a caller can wait for the one after a reload. */
  generation: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class AgentServer {
  private readonly server: WebSocketServer;
  private readonly connections = new Map<Side, Connection>();
  private readonly pending = new Map<number, Pending>();
  private readonly waiters: (() => void)[] = [];
  private generation = 0;
  private nextId = 1;
  readonly logs: string[] = [];

  private constructor(server: WebSocketServer) {
    this.server = server;
    server.on("connection", (socket, request) => {
      const side = new URL(request.url ?? "/", "http://localhost").searchParams.get("side");
      if (side !== "zam" && side !== "zami") {
        socket.close();
        return;
      }
      socket.on("message", (data) => {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(new Uint8Array(data));
        this.receive(side, socket, bytes.toString("utf8"));
      });
    });
  }

  static listen(port: number): Promise<AgentServer> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({ port });
      server.once("listening", () => resolve(new AgentServer(server)));
      server.once("error", reject);
    });
  }

  private receive(side: Side, socket: WebSocket, data: string): void {
    const message = JSON.parse(data) as AgentMessage;
    switch (message.type) {
      case "hello": {
        this.generation += 1;
        this.connections.set(side, { socket, hello: message, generation: this.generation });
        for (const wake of this.waiters.splice(0)) wake();
        break;
      }
      case "reply": {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new Error(message.error));
        break;
      }
      case "log": {
        this.logs.push(`[${side}] ${message.message}`);
        break;
      }
    }
  }

  /** The latest connection's generation for `side` (0 if it never connected). */
  generationOf(side: Side): number {
    return this.connections.get(side)?.generation ?? 0;
  }

  hello(side: Side): Hello {
    const connection = this.connections.get(side);
    if (!connection) throw new Error(`The ${side} app isn't connected`);
    return connection.hello;
  }

  /** Waits for `side` to connect with a generation above `after`. */
  async connected(side: Side, after: number, timeoutMs: number): Promise<Hello> {
    const deadline = Date.now() + timeoutMs;
    while (this.generationOf(side) <= after) {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error(`The ${side} app didn't connect within ${timeoutMs / 1000} s`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return this.hello(side);
  }

  request<T = unknown>(side: Side, command: Command, timeoutMs = 60_000): Promise<T> {
    const connection = this.connections.get(side);
    if (!connection) return Promise.reject(new Error(`The ${side} app isn't connected`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`The ${side} app didn't answer ${command.cmd} within ${timeoutMs / 1000} s`),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      connection.socket.send(JSON.stringify({ id, ...command }));
    });
  }

  close(): void {
    for (const { socket } of this.connections.values()) socket.terminate();
    this.server.close();
  }
}
