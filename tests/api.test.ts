import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { createServer } from "node:net";

test("本人認証・CSRF・競合防止・ログアウト・SQLite永続化をAPIで検証", async (t) => {
  mkdirSync("output/tmp", { recursive: true });
  const folder = mkdtempSync(
    resolve(
      "output/tmp/" +
        new Date().toISOString().replace(/\D/g, "").slice(0, 14) +
        "_api-",
    ),
  );
  const dbPath = resolve(folder, "ledger.sqlite");
  const reservation = createServer();
  await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((r) => reservation.close(() => r()));
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  async function stop() {
    if (child && child.exitCode === null) {
      const old = child;
      await new Promise<void>((resolve) => {
        old.once("exit", () => resolve());
        old.kill("SIGTERM");
      });
    }
  }
  t.after(stop);
  async function start() {
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DB_PATH: dbPath,
        PORT: String(port),
        HOST: "127.0.0.1",
      },
      stdio: "pipe",
    });
    let log = "";
    child.stderr?.on("data", (chunk) => (log += chunk));
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/health")).ok) return;
      } catch {}
      if (child.exitCode !== null) throw new Error("API server failed: " + log);
      await setTimeout(100);
    }
    throw new Error("API server did not become ready");
  }
  await start();
  let response = await fetch(base + "/api/state");
  assert.equal(response.status, 401);
  const password = randomBytes(24).toString("base64url");
  const post = async (
    path: string,
    body: unknown,
    cookie = "",
    extra: Record<string, string> = {},
  ) =>
    fetch(base + "/api/" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ledger-Request": "1",
        Cookie: cookie,
        ...extra,
      },
      body: JSON.stringify(body),
    });
  response = await fetch(base + "/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "検証", password, demo: false }),
  });
  assert.equal(response.status, 403);
  response = await post("setup", { name: "検証", password, demo: false });
  assert.equal(response.status, 200);
  const cookieHeader = response.headers.get("set-cookie")!;
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);
  const cookie = cookieHeader.split(";")[0];
  response = await post("setup", { name: "上書き", password, demo: false });
  assert.equal(response.status, 400);
  response = await fetch(base + "/api/state", { headers: { Cookie: cookie } });
  const first = await response.json();
  assert.equal(first.revision, 0);
  assert.equal(first.entries.length, 0);
  const command = {
    type: "account",
    account: {
      id: "bank",
      name: "生活用口座",
      type: "bank",
      openingBalance: 100000,
    },
  };
  response = await post("command", { revision: 0, command }, cookie, {
    Origin: "https://example.invalid",
  });
  assert.equal(response.status, 403);
  response = await post("command", { revision: 0, command });
  assert.equal(response.status, 401);
  response = await post("command", { revision: 0, command }, cookie);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 1);
  response = await post("command", { revision: 0, command }, cookie);
  assert.equal(response.status, 409);
  response = await post(
    "command",
    {
      revision: 1,
      command: {
        type: "account",
        account: { ...command.account, id: "bad", openingBalance: 1.5 },
      },
    },
    cookie,
  );
  assert.equal(response.status, 400);
  response = await fetch(base + "/api/export", { headers: { Cookie: cookie } });
  const exported = await response.text();
  assert.equal(JSON.parse(exported).accounts.length, 1);
  assert.ok(!exported.includes(password));
  assert.ok(!exported.includes("salt"));
  assert.equal(response.headers.get("cache-control"), "no-store");
  await stop();
  await start();
  response = await fetch(base + "/api/state", { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).accounts[0].openingBalance, 100000);
  response = await post("logout", {}, cookie);
  assert.equal(response.status, 200);
  response = await fetch(base + "/api/state", { headers: { Cookie: cookie } });
  assert.equal(response.status, 401);
  response = await post("login", { password: "wrong" });
  assert.equal(response.status, 401);
  response = await post("login", { password });
  assert.equal(response.status, 200);
});
