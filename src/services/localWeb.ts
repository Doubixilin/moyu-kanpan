import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import type { PublicSnapshot, PublicTrend } from "../presentation/publicSnapshot.js";

/** 带状态码的客户端错误：让 handle() 能返回 4xx 而不是一律 500。 */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface LocalWorkWebOptions {
  assetRoot: string;
  snapshot: () => PublicSnapshot;
  trend?: (code: string) => Promise<PublicTrend | null>;
  onVisibleClientsChange?: (count: number) => void;
  token?: string;
}

export class LocalWorkWebServer {
  private readonly token: string;
  private server: Server | null = null;
  private port = 0;
  private readonly streams = new Map<ServerResponse, string>();
  private readonly visibleClients = new Set<string>();
  private heartbeat: NodeJS.Timeout | null = null;
  private assets = new Map<string, { body: Buffer; contentType: string }>();
  private readonly trendCache = new Map<string, { savedAt: number; value: PublicTrend }>();
  private readonly trendInFlight = new Map<string, Promise<PublicTrend | null>>();

  constructor(private readonly options: LocalWorkWebOptions) {
    // 空串/纯空白必须等同于"没提供 token"：否则 `matchesToken("")` 会因为两个 0 长度
    // buffer 而返回 true（`timingSafeEqual` 对空 buffer 返回 true），空 token 即可建会话。
    const provided = options.token?.trim();
    this.token = provided ? provided : randomBytes(24).toString("base64url");
  }

  get origin(): string {
    if (!this.port) throw new Error("Local work web server has not started");
    return `http://127.0.0.1:${this.port}`;
  }

  get url(): string {
    return `${this.origin}/#${encodeURIComponent(this.token)}`;
  }

  async start(preferredPort = 0): Promise<void> {
    if (this.server) return;
    this.assets = new Map([
      [
        "/",
        {
          body: await readFile(path.join(this.options.assetRoot, "work.html")),
          contentType: "text/html; charset=utf-8"
        }
      ],
      [
        "/assets/workweb.js",
        {
          body: await readFile(path.join(this.options.assetRoot, "assets/workweb.js")),
          contentType: "text/javascript; charset=utf-8"
        }
      ],
      [
        "/assets/workweb.css",
        {
          body: await readFile(path.join(this.options.assetRoot, "assets/workweb.css")),
          contentType: "text/css; charset=utf-8"
        }
      ]
    ]);
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(preferredPort, "127.0.0.1", () => {
        server.off("error", onError);
        const address = server.address();
        if (!address || typeof address === "string")
          return reject(new Error("Unable to resolve local work web port"));
        this.port = address.port;
        resolve();
      });
    });
    this.heartbeat = setInterval(() => {
      for (const response of [...this.streams.keys()])
        this.writeStream(response, ": keepalive\n\n");
      // "可见"应当等价于"还有打开的 SSE 流"：被强杀的标签页不会发 FIN，
      // 只靠 close 事件可能长期残留，让前台轮询一直跑在快节奏上。
      const live = new Set(this.streams.values());
      let changed = false;
      for (const clientId of [...this.visibleClients]) {
        if (live.has(clientId)) continue;
        this.visibleClients.delete(clientId);
        changed = true;
      }
      if (changed) this.notifyVisibility();
    }, 15_000);
  }

  broadcast(snapshot: PublicSnapshot): void {
    const message = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const response of [...this.streams.keys()]) this.writeStream(response, message);
  }

  /** 单个客户端的写入失败不能影响其它订阅者，也不能抛出未捕获异常。 */
  private writeStream(response: ServerResponse, chunk: string): void {
    if (response.writableEnded || response.destroyed) {
      this.dropStream(response);
      return;
    }
    try {
      response.write(chunk);
    } catch {
      this.dropStream(response);
    }
  }

  private dropStream(response: ServerResponse): void {
    const clientId = this.streams.get(response);
    if (!this.streams.delete(response)) return;
    if (clientId) this.visibleClients.delete(clientId);
    this.notifyVisibility();
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const response of this.streams.keys()) response.end();
    this.streams.clear();
    this.visibleClients.clear();
    this.trendCache.clear();
    this.trendInFlight.clear();
    this.notifyVisibility();
    const server = this.server;
    this.server = null;
    this.port = 0;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(
    request: import("node:http").IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    try {
      if (!this.validHost(request.headers.host)) return this.send(response, 403, "Forbidden");
      const url = new URL(request.url ?? "/", this.origin);
      const asset = this.assets.get(url.pathname);
      if (request.method === "GET" && asset) {
        response.writeHead(200, this.staticHeaders(asset.contentType));
        response.end(asset.body);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/session") {
        if (
          !this.validOrigin(request.headers.origin) ||
          !this.matchesToken(request.headers["x-local-token"])
        ) {
          return this.send(response, 403, "Forbidden");
        }
        response.writeHead(204, {
          ...this.apiHeaders(),
          "Set-Cookie": `moyu_local=${this.token}; HttpOnly; SameSite=Strict; Path=/`
        });
        response.end();
        return;
      }
      if (!this.validOrigin(request.headers.origin) || !this.hasSession(request.headers.cookie)) {
        return this.send(response, 401, "Unauthorized");
      }
      if (request.method === "GET" && url.pathname === "/api/public-snapshot") {
        return this.sendJson(response, this.options.snapshot());
      }
      if (request.method === "GET" && url.pathname === "/api/trend") {
        const code = url.searchParams.get("code") ?? "";
        if (!/^\d{6}$/.test(code) || !this.options.trend)
          return this.send(response, 404, "Not Found");
        const trend = await this.getTrend(code);
        return trend ? this.sendJson(response, trend) : this.send(response, 404, "Not Found");
      }
      if (request.method === "GET" && url.pathname === "/api/events") {
        const clientId = safeClientId(url.searchParams.get("client"));
        response.writeHead(200, {
          ...this.apiHeaders(),
          "Content-Type": "text/event-stream; charset=utf-8",
          Connection: "keep-alive"
        });
        response.write(`event: snapshot\ndata: ${JSON.stringify(this.options.snapshot())}\n\n`);
        this.streams.set(response, clientId);
        // 没有 error 监听时，向已断开的客户端写入会抛出未处理的 'error'。
        const drop = () => this.dropStream(response);
        response.on("error", drop);
        request.on("close", drop);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/visibility") {
        const body = await readJsonBody(request);
        const clientId = safeClientId(body.clientId);
        if (!clientId || typeof body.visible !== "boolean")
          return this.send(response, 400, "Bad Request");
        if (body.visible) this.visibleClients.add(clientId);
        else this.visibleClients.delete(clientId);
        this.notifyVisibility();
        response.writeHead(204, this.apiHeaders());
        response.end();
        return;
      }
      this.send(response, 404, "Not Found");
    } catch (error) {
      // 区分客户端错误与真正的服务端异常：此前请求体超限/JSON 非法都会返回 500。
      if (error instanceof HttpError) return this.send(response, error.status, error.message);
      this.send(response, 500, "Internal Server Error");
    }
  }

  private validHost(host: string | undefined): boolean {
    return host === `127.0.0.1:${this.port}`;
  }

  private validOrigin(origin: string | undefined): boolean {
    return !origin || origin === this.origin;
  }

  private matchesToken(value: string | string[] | undefined): boolean {
    if (typeof value !== "string") return false;
    // 空值必须直接拒绝：两个空 buffer 会被 timingSafeEqual 判为相等。
    if (!value || !this.token) return false;
    const left = Buffer.from(value);
    const right = Buffer.from(this.token);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private hasSession(cookie: string | undefined): boolean {
    if (!cookie) return false;
    // 与 header 路径一致地走常数时间比较（此前这里用 `===`，两条路径强度不同）。
    return cookie.split(";").some((entry) => {
      const trimmed = entry.trim();
      if (!trimmed.startsWith("moyu_local=")) return false;
      return this.matchesToken(trimmed.slice("moyu_local=".length));
    });
  }

  private notifyVisibility(): void {
    this.options.onVisibleClientsChange?.(this.visibleClients.size);
  }

  private async getTrend(code: string): Promise<PublicTrend | null> {
    const cached = this.trendCache.get(code);
    if (cached && Date.now() - cached.savedAt < 5 * 60_000) return cached.value;
    const existing = this.trendInFlight.get(code);
    if (existing) return existing;
    const request = this.options.trend!(code)
      .then((value) => {
        if (value) this.trendCache.set(code, { savedAt: Date.now(), value });
        return value;
      })
      .finally(() => this.trendInFlight.delete(code));
    this.trendInFlight.set(code, request);
    return request;
  }

  private staticHeaders(contentType: string): Record<string, string> {
    return {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin"
    };
  }

  private apiHeaders(): Record<string, string> {
    return {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    };
  }

  private sendJson(response: ServerResponse, value: unknown): void {
    response.writeHead(200, {
      ...this.apiHeaders(),
      "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify(value));
  }

  private send(response: ServerResponse, status: number, body: string): void {
    if (response.headersSent) {
      response.end();
      return;
    }
    response.writeHead(status, {
      ...this.apiHeaders(),
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end(body);
  }
}

function safeClientId(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? value : "";
}

async function readJsonBody(
  request: import("node:http").IncomingMessage
): Promise<Record<string, unknown>> {
  let text = "";
  // IncomingMessage 的异步迭代元素类型是 any；显式收敛为 Node 实际产出的类型。
  for await (const chunk of request as AsyncIterable<Buffer | string>) {
    text += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (text.length > 1024) throw new HttpError(413, "Payload Too Large");
  }
  let value: unknown;
  try {
    value = JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "Bad Request");
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
