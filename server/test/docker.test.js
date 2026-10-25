import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { cpuPercent, createDockerEngine, demuxLogs, memoryUsage, resolveDockerHost } from "../src/docker.js";

test("resolveDockerHost entiende DOCKER_HOST y el sistema operativo", () => {
  assert.deepEqual(resolveDockerHost("", "linux"), { socketPath: "/var/run/docker.sock" });
  assert.deepEqual(resolveDockerHost("", "win32"), { socketPath: "\\\\.\\pipe\\docker_engine" });
  assert.deepEqual(resolveDockerHost("tcp://10.0.0.5:2376"), { host: "10.0.0.5", port: 2376 });
  assert.deepEqual(resolveDockerHost("unix:///run/user/1000/docker.sock"), { socketPath: "/run/user/1000/docker.sock" });
  assert.deepEqual(resolveDockerHost("npipe:////./pipe/docker_engine"), { socketPath: "\\\\.\\pipe\\docker_engine" });
});

function frame(stream, text) {
  const body = Buffer.from(text);
  const head = Buffer.alloc(8);
  head[0] = stream;
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
}

test("demuxLogs separa las tramas de stdout/stderr y deja pasar los logs con TTY", () => {
  const buf = Buffer.concat([frame(1, "hola\n"), frame(2, "error\n"), frame(1, "adiós\n")]);
  assert.equal(demuxLogs(buf), "hola\nerror\nadiós\n");
  assert.equal(demuxLogs(Buffer.from("salida con tty\n")), "salida con tty\n");
});

test("cpuPercent y memoryUsage calculan como docker stats", () => {
  const prev = { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 100_000, online_cpus: 4 };
  const cur = { cpu_usage: { total_usage: 6_000 }, system_cpu_usage: 200_000, online_cpus: 4 };
  assert.equal(cpuPercent(cur, prev), 20);
  assert.equal(cpuPercent(cur, undefined), 0);
  assert.deepEqual(memoryUsage({ usage: 500, limit: 1000, stats: { inactive_file: 100 } }), { used: 400, limit: 1000 });
  assert.deepEqual(memoryUsage({ usage: 500, limit: 1000, stats: { cache: 50 } }), { used: 450, limit: 1000 });
});

// Docker Engine falso que responde por TCP como lo haría el real
let server;
let engine;
const requests = [];
let cpuTotal = 0;

before(async () => {
  server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const json = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/_ping") return res.end("OK");
    if (req.url === "/containers/json?all=true") {
      return json(200, [
        { Id: "bbbbbbbbbbbb1111", Names: ["/web"], Image: "nginx", State: "running", Status: "Up 2 hours", Created: 1700000000, Labels: {}, Ports: [{ PrivatePort: 80, PublicPort: 8080 }, { PrivatePort: 80, PublicPort: 8080 }] },
        { Id: "aaaaaaaaaaaa2222", Names: ["/api"], Image: "node", State: "exited", Status: "Exited (0)", Created: 1700000000, Labels: { "com.docker.compose.project": "shop" }, Ports: [] },
      ]);
    }
    if (req.url.startsWith("/containers/bbbbbbbbbbbb/stats")) {
      cpuTotal += 5_000;
      return json(200, {
        cpu_stats: { cpu_usage: { total_usage: cpuTotal }, system_cpu_usage: cpuTotal * 10, online_cpus: 2 },
        memory_stats: { usage: 2048, limit: 8192, stats: { inactive_file: 1024 } },
        networks: { eth0: { rx_bytes: 10, tx_bytes: 20 }, eth1: { rx_bytes: 1, tx_bytes: 2 } },
      });
    }
    if (req.url.startsWith("/containers/bbbbbbbbbbbb/logs")) {
      res.writeHead(200, { "Content-Type": "application/vnd.docker.raw-stream" });
      return res.end(Buffer.concat([frame(1, "uno\n"), frame(2, "dos\n")]));
    }
    if (req.method === "POST" && req.url === "/containers/bbbbbbbbbbbb/restart") {
      res.writeHead(204);
      return res.end();
    }
    json(404, { message: "No such container: nope" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  engine = createDockerEngine({ dockerHost: `tcp://127.0.0.1:${server.address().port}` });
});

after(() => server.close());

test("el cliente de Docker lista, mide, lee logs y ejecuta acciones", async () => {
  assert.equal(await engine.ping(), true);

  const list = await engine.listContainers();
  assert.deepEqual(list.map((c) => c.name), ["api", "web"]);
  assert.deepEqual(list[1].ports, ["8080:80"]);
  assert.equal(list[0].project, "shop");
  assert.equal(list[1].id, "bbbbbbbbbbbb");

  const first = await engine.stats("bbbbbbbbbbbb");
  assert.equal(first.cpu, 0, "sin muestra previa no hay % de CPU");
  const second = await engine.stats("bbbbbbbbbbbb");
  assert.equal(second.cpu, 20); // 5000 / 50000 * 2 cpus * 100
  assert.equal(second.memUsed, 1024);
  assert.equal(second.netRx, 11);

  assert.equal(await engine.logs("bbbbbbbbbbbb", 50), "uno\ndos\n");
  assert.ok(requests.some((r) => r.includes("tail=50")));

  await engine.action("bbbbbbbbbbbb", "restart");
  await assert.rejects(engine.stats("nope"), { status: 404, message: "No such container: nope" });
});

test("si Docker no está disponible el error es claro", async () => {
  const offline = createDockerEngine({ dockerHost: "tcp://127.0.0.1:1" });
  await assert.rejects(offline.listContainers(), (err) => err.status === 502 && /No se puede conectar con Docker/.test(err.message));
});
