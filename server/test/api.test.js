import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import request from "supertest";
import { createApp } from "../src/app.js";
import { createDemoEngine } from "../src/demoDocker.js";
import { createMonitor } from "../src/monitor.js";
import { GitHubError } from "../src/github.js";

const github = {
  rateLimit: { limit: 60, remaining: 42, reset: null },
  async overview(username) {
    if (username === "nadie") throw new GitHubError("Ese usuario no existe en GitHub", 404);
    return { profile: { login: username } };
  },
};

let engine;
let monitor;
let app;

before(() => {
  engine = createDemoEngine();
  monitor = createMonitor(engine, { pollMs: 50 });
  app = createApp({ github, engine, monitor, defaultUser: "IviDev02" });
});

after(() => monitor.close());

test("GET /api/status informa del modo de Docker y de GitHub", async () => {
  const res = await request(app).get("/api/status").expect(200);
  assert.equal(res.body.docker.mode, "demo");
  assert.equal(res.body.docker.connected, true);
  assert.equal(res.body.github.defaultUser, "IviDev02");
  assert.equal(res.body.github.rateLimit.remaining, 42);
});

test("GET /api/github/:user devuelve el resumen o el error de GitHub", async () => {
  const ok = await request(app).get("/api/github/octocat").expect(200);
  assert.equal(ok.body.profile.login, "octocat");
  const missing = await request(app).get("/api/github/nadie").expect(404);
  assert.equal(missing.body.error, "Ese usuario no existe en GitHub");
});

test("GET /api/docker/containers devuelve contenedores con métricas", async () => {
  const res = await request(app).get("/api/docker/containers").expect(200);
  assert.ok(res.body.containers.length >= 5);
  const running = res.body.containers.filter((c) => c.state === "running");
  assert.ok(running.every((c) => c.stats && c.stats.memLimit > 0));
  assert.ok(res.body.containers.some((c) => c.state === "exited" && c.stats === null));
});

test("las acciones exigen la cabecera X-DevDash y validan la acción", async () => {
  const { body } = await request(app).get("/api/docker/containers");
  const stopped = body.containers.find((c) => c.state === "exited");

  await request(app).post(`/api/docker/containers/${stopped.id}/start`).expect(403);
  await request(app).post(`/api/docker/containers/${stopped.id}/kill`).set("X-DevDash", "1").expect(400);
  await request(app).post("/api/docker/containers/no-existe/start").set("X-DevDash", "1").expect(404);

  const res = await request(app).post(`/api/docker/containers/${stopped.id}/start`).set("X-DevDash", "1").expect(200);
  assert.equal(res.body.container.state, "running");

  // Arrancar uno que ya está en marcha es un conflicto
  await request(app).post(`/api/docker/containers/${stopped.id}/start`).set("X-DevDash", "1").expect(409);
  await request(app).post(`/api/docker/containers/${stopped.id}/stop`).set("X-DevDash", "1").expect(200);
});

test("en modo solo lectura no se pueden ejecutar acciones", async () => {
  const ro = createApp({ github, engine, monitor, defaultUser: "x", readonly: true });
  const { body } = await request(ro).get("/api/docker/containers");
  const res = await request(ro).post(`/api/docker/containers/${body.containers[0].id}/stop`).set("X-DevDash", "1").expect(403);
  assert.match(res.body.error, /solo lectura/);
});

test("GET logs devuelve las últimas líneas", async () => {
  const { body } = await request(app).get("/api/docker/containers");
  const res = await request(app).get(`/api/docker/containers/${body.containers[0].id}/logs?tail=10`).expect(200);
  assert.equal(res.body.logs.trim().split("\n").length, 10);
  await request(app).get("/api/docker/containers/..%2Fetc/logs").expect(400);
});

test("rutas de la API desconocidas devuelven 404 en JSON", async () => {
  const res = await request(app).get("/api/nada").expect(404);
  assert.equal(res.body.error, "Ruta no encontrada");
});

// Lee eventos SSE hasta reunir `count` o agotar el tiempo
function readEvents(port, count) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get({ port, path: "/api/docker/stream" }, (res) => {
      assert.equal(res.headers["content-type"], "text/event-stream");
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const event = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (event) events.push({ event, data: JSON.parse(data) });
          if (events.length >= count) {
            req.destroy();
            resolve(events);
          }
        }
      });
    });
    req.on("error", (err) => (err.code === "ECONNRESET" ? null : reject(err)));
    setTimeout(() => reject(new Error("timeout esperando eventos")), 3000);
  });
}

test("el stream SSE manda un snapshot y luego ticks, y se para al quedarse sin clientes", async () => {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const events = await readEvents(server.address().port, 3);
    assert.equal(events[0].event, "snapshot");
    assert.ok(events[0].data.history);
    assert.equal(events[1].event, "tick");
    assert.ok(events[2].data.t >= events[1].data.t);

    // El histórico va creciendo con cada lectura
    const snap = monitor.snapshot();
    const running = snap.containers.find((c) => c.state === "running");
    assert.ok(snap.history[running.id].length >= 2);

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(monitor.clientCount, 0);
  } finally {
    server.close();
  }
});
