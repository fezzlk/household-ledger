import express from "express";
import { resolve } from "node:path";
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";
import {
  demoState,
  emptyState,
} from "../shared/domain.js";

import { createStore, RevisionConflict } from "./store.js";
import { validBootstrap } from "./bootstrap.js";
const store = await createStore();
const cloud = store.kind === "firestore";
if (process.env.K_SERVICE && (!cloud || !process.env.BOOTSTRAP_TOKEN || process.env.SECURE_COOKIE !== "true")) {
  throw new Error("本番の永続ストア・初期設定コード・Secure Cookie設定が必要です");
}
if (cloud && !process.env.BOOTSTRAP_TOKEN) throw new Error("初期設定コードが設定されていません");
const app = express();
const httpServer = createServer(app);
app.disable("x-powered-by");
if (process.env.K_SERVICE) app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  if (req.path.startsWith("/api")) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET" && req.get("x-ledger-request") !== "1")
      return res.status(403).json({ error: "アプリから操作してください" });
    const origin = req.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== req.get("host"))
          return res.status(403).json({ error: "接続元が一致しません" });
      } catch {
        return res.status(403).json({ error: "接続元を確認してください" });
      }
    }
  }
  next();
});
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
async function authenticated(req: express.Request) {
  const token = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("ledger_session="))
    ?.slice(15);
  return !!token && await store.hasSession(digest(token));
}
async function session(res: express.Response) {
  const token = randomBytes(32).toString("hex");
  await store.putSession(digest(token), Date.now() + 7 * 86400000);
  res.setHeader(
    "Set-Cookie",
    `ledger_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${process.env.SECURE_COOKIE === "true" ? "; Secure" : ""}`,
  );
}
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/session", async (req, res) => {
  const owner = await store.getOwner();
  const loggedIn = await authenticated(req);
  res.json({ setup: !owner, authenticated: loggedIn, name: loggedIn ? owner?.name : undefined, cloud, bootstrapRequired: cloud && !owner });
});
const attempts = new Map<string, { n: number; until: number }>();
app.post("/api/login", async (req, res) => {
  const key = req.ip ?? req.socket.remoteAddress ?? "local",
    record = attempts.get(key);
  if (record && record.until > Date.now() && record.n >= 8)
    return res
      .status(429)
      .json({ error: "しばらく待ってからログインしてください" });
  const { password } = z
    .object({ password: z.string().max(128) })
    .parse(req.body);
  const owner = await store.getOwner();
  const candidate = scryptSync(password, owner?.salt ?? "unused", 64);
  if (!owner || !timingSafeEqual(candidate, Buffer.from(owner.hash, "hex"))) {
    attempts.set(key, {
      n: record && record.until > Date.now() ? record.n + 1 : 1,
      until: Date.now() + 15 * 60000,
    });
    return res.status(401).json({ error: "パスワードを確認してください" });
  }
  attempts.delete(key);
  await session(res);
  res.json({ ok: true });
});
app.post("/api/setup", async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(1).max(40),
      password: z.string().min(12).max(128),
      demo: z.boolean(),
      bootstrapToken: z.string().max(128).optional(),
    })
    .parse(req.body);
  if(cloud && !validBootstrap(input.bootstrapToken,process.env.BOOTSTRAP_TOKEN)) return res.status(403).json({error:"初回設定コードを確認してください"});
  if(cloud && input.demo) return res.status(400).json({error:"本番ではサンプルデータを作成できません"});
  const salt = randomBytes(32).toString("hex");
  const hash = scryptSync(input.password, salt, 64).toString("hex");
  await store.setup({name:input.name,salt,hash}, input.demo ? demoState() : emptyState());
  await session(res);
  res.json({ ok: true });
});
app.use("/api", async (req, res, next) => {
  if(await authenticated(req)) next(); else res.status(401).json({error:"ログインしてください"});
});
app.post("/api/logout", async (req, res) => {
  const token = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("ledger_session="))
    ?.slice(15);
  if (token) await store.deleteSession(digest(token));
  res.setHeader(
    "Set-Cookie",
    "ledger_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
  );
  res.json({ ok: true });
});
app.get("/api/state", async (_req, res) => res.json(await store.getState()));
app.post("/api/command", async (req, res) => {
  const {revision,command} = z.object({revision:z.number().int(),command:z.unknown()}).parse(req.body);
  res.json(await store.command(revision,command));
});
app.get("/api/export", async (_req, res) => {
  res.setHeader("Content-Disposition", 'attachment; filename="ledger-backup.json"');
  res.type("application/json").send(JSON.stringify(await store.getState()));
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "APIが見つかりません" }),
);
if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if(error instanceof RevisionConflict) return res.status(409).json({error:error.message});
    if(typeof error === "object" && error && "code" in error && typeof error.code === "number") { console.error("保存先との通信エラー",error.code); return res.status(503).json({error:"保存先に接続できませんでした。時間をおいて再度お試しください"}); }
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({
          error: error.issues[0]?.message ?? "入力内容を確認してください",
        });
    res
      .status(400)
      .json({
        error: error instanceof Error ? error.message : "処理できませんでした",
      });
  },
);
const port = Number(process.env.PORT ?? 5178),
  host = process.env.HOST ?? "127.0.0.1";
httpServer.listen(port, host, () =>
  console.log(`くらし通帳: http://localhost:${port}`),
);
