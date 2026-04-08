import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWebServer } from "../dist/web/server/index.js";

test("web server applies security headers to API responses", async () => {
  const webServer = await startServer();

  try {
    const response = await fetch(`${webServer.baseUrl}/api/config`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  } finally {
    await webServer.stop();
  }
});

test("web server rate limits mutating requests", async () => {
  const webServer = await startServer();

  try {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const response = await fetch(`${webServer.baseUrl}/api/actions/revise-plan`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 400, `attempt ${attempt} should still reach route validation`);
    }

    const blocked = await fetch(`${webServer.baseUrl}/api/actions/revise-plan`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    assert.equal(blocked.status, 429);
    assert.match(await blocked.text(), /Too many mutating requests/);
  } finally {
    await webServer.stop();
  }
});

test("web server rejects symlinked memory paths and omits symlink entries from listings", async () => {
  const webServer = await startServer(rootDir => {
    const externalDir = join(rootDir, "outside-dir");
    mkdirSync(externalDir, { recursive: true });
    writeFileSync(join(rootDir, "outside.txt"), "secret\n", "utf-8");
    writeFileSync(join(externalDir, "nested.txt"), "nested\n", "utf-8");
    symlinkSync(join(rootDir, "outside.txt"), join(rootDir, "memory", "outside-link"), "file");
    symlinkSync(externalDir, join(rootDir, "memory", "outside-dir-link"), "dir");
  });

  try {
    const listing = await fetch(`${webServer.baseUrl}/api/memory/tree?path=.`);
    assert.equal(listing.status, 200);
    const listingJson = await listing.json();
    assert.equal(listingJson.entries.some(entry => entry.name === "outside-link"), false);
    assert.equal(listingJson.entries.some(entry => entry.name === "outside-dir-link"), false);

    const fileResponse = await fetch(`${webServer.baseUrl}/api/memory/file?path=outside-link`);
    assert.equal(fileResponse.status, 400);
    assert.match(await fileResponse.text(), /Invalid memory path/);

    const dirResponse = await fetch(`${webServer.baseUrl}/api/memory/tree?path=outside-dir-link`);
    assert.equal(dirResponse.status, 400);
    assert.match(await dirResponse.text(), /Invalid memory path/);
  } finally {
    await webServer.stop();
  }
});

test("web server session route exposes execution intent summary counts", async () => {
  const webServer = await startServer(rootDir => {
    mkdirSync(join(rootDir, "workspace", "runtime-state"), { recursive: true });
    writeFileSync(join(rootDir, "workspace", "runtime-state", "execution-intents.json"), JSON.stringify([
      { status: "pending" },
      { status: "pending" },
      { status: "completed" },
      { status: "failed" },
    ], null, 2));
  }, {
    sessionId: "session-001",
    goal: "Ship queue replay",
    status: "active",
    startedAt: "2026-04-08T17:00:00+02:00",
    currentWave: 2,
    activeWorkers: new Map(),
  });

  try {
    const response = await fetch(`${webServer.baseUrl}/api/session/active`);
    assert.equal(response.status, 200);
    const json = await response.json();

    assert.deepEqual(json.executionIntentSummary, {
      total: 4,
      pending: 2,
      inProgress: 0,
      completed: 1,
      skipped: 0,
      failed: 1,
    });
  } finally {
    await webServer.stop();
  }
});

async function startServer(setup, session = null) {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-web-"));
  mkdirSync(join(rootDir, "workspace"), { recursive: true });
  mkdirSync(join(rootDir, "skills"), { recursive: true });
  mkdirSync(join(rootDir, "memory"), { recursive: true });
  mkdirSync(join(rootDir, "web", "client"), { recursive: true });
  if (typeof setup === "function") {
    setup(rootDir);
  }

  const server = createWebServer({
    rootDir,
    config: {
      tmux_session: "agent-maestro-test",
      paths: {
        workspace: "workspace",
        skills: "skills",
        memory: "memory",
      },
    },
    taskManager: {
      readTask: () => null,
      updateStatus: () => {},
      setRevisionFeedback: () => {},
    },
    agentResolver: {
      getAllAgents: () => [],
    },
    logger: {
      logEntry: () => {},
    },
    getSession: () => session,
  });

  await server.start(0, "127.0.0.1");
  const address = server.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => server.stop(),
  };
}
