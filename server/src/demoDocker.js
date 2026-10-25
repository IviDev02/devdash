import { DockerError } from "./docker.js";

const MB = 1024 * 1024;

// Contenedores ficticios para enseñar el dashboard sin tener Docker instalado
const SEED = [
  { name: "taskflow-api-1", image: "taskflow-api", project: "taskflow", ports: ["4000:4000"], cpu: 6, mem: 140, limit: 512, log: "api" },
  { name: "taskflow-web-1", image: "taskflow-web", project: "taskflow", ports: ["8080:80"], cpu: 1, mem: 12, limit: 256, log: "nginx" },
  { name: "taskflow-mongo-1", image: "mongo:8", project: "taskflow", ports: [], cpu: 4, mem: 310, limit: 1024, log: "mongo" },
  { name: "shop-postgres", image: "postgres:17-alpine", project: "shopapi", ports: ["5432:5432"], cpu: 3, mem: 85, limit: 1024, log: "postgres" },
  { name: "shop-redis", image: "redis:8-alpine", project: "shopapi", ports: ["6379:6379"], cpu: 1.5, mem: 9, limit: 256, log: "redis" },
  { name: "shop-worker", image: "shopapi-worker", project: "shopapi", ports: [], cpu: 12, mem: 180, limit: 512, log: "worker", stopped: true },
];

const LOGS = {
  api: () => pick([`GET /api/boards 200 ${rnd(4, 40)}ms`, `PATCH /api/tasks/${hex(6)} 200 ${rnd(6, 30)}ms`, `socket conectado (${rnd(1, 6)} usuarios en el tablero)`, `POST /api/auth/login 200 ${rnd(60, 120)}ms`]),
  nginx: () => `172.18.0.1 - - "GET ${pick(["/", "/assets/index.js", "/api/boards", "/favicon.svg"])} HTTP/1.1" ${pick([200, 200, 200, 304])} ${rnd(200, 9000)}`,
  mongo: () => pick([`{"c":"NETWORK","msg":"Connection accepted","attr":{"connectionCount":${rnd(3, 12)}}}`, `{"c":"COMMAND","msg":"Slow query","attr":{"durationMillis":${rnd(100, 300)}}}`, `{"c":"STORAGE","msg":"WiredTiger checkpoint"}`]),
  postgres: () => pick(["LOG:  checkpoint starting: time", `LOG:  checkpoint complete: wrote ${rnd(3, 90)} buffers`, "LOG:  autovacuum: processing database \"shop\""]),
  redis: () => pick([`* ${rnd(10, 200)} changes in 300 seconds. Saving...`, "* Background saving terminated with success", "* DB saved on disk"]),
  worker: () => pick([`procesando pedido #${rnd(1000, 9999)}`, `email de confirmación enviado (${rnd(80, 300)}ms)`, "cola vacía, esperando trabajos"]),
};

function rnd(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function hex(n) {
  return Array.from({ length: n }, () => rnd(0, 16).toString(16)).join("");
}
function formatUptime(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Less than a second";
  if (min < 60) return `${min} minutes`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} hours` : `${Math.floor(h / 24)} days`;
}

export function createDemoEngine({ now = Date.now } = {}) {
  const start = now();
  const containers = SEED.map((s, i) => ({
    ...s,
    id: hex(12),
    created: start - (i + 2) * 3600_000 * 7,
    startedAt: s.stopped ? null : start - (i + 1) * 3600_000 * 5,
    finishedAt: s.stopped ? start - 40 * 60000 : null,
    curCpu: s.cpu,
    curMem: s.mem,
    rx: rnd(5, 80) * MB,
    tx: rnd(2, 40) * MB,
  }));

  function find(id) {
    const c = containers.find((c) => c.id === id || c.name === id);
    if (!c) throw new DockerError("No such container", 404);
    return c;
  }

  function status(c) {
    return c.startedAt ? `Up ${formatUptime(now() - c.startedAt)}` : `Exited (0) ${formatUptime(now() - c.finishedAt)} ago`;
  }

  return {
    mode: "demo",

    async ping() {
      return true;
    },

    async info() {
      return { engine: "demo", os: "linux", arch: "x86_64" };
    },

    async listContainers() {
      return containers.map((c) => ({
        id: c.id,
        name: c.name,
        image: c.image,
        state: c.startedAt ? "running" : "exited",
        status: status(c),
        created: c.created,
        project: c.project,
        ports: c.ports,
      }));
    },

    async stats(id) {
      const c = find(id);
      if (!c.startedAt) return { cpu: 0, memUsed: 0, memLimit: c.limit * MB, netRx: c.rx, netTx: c.tx };
      // Paseo aleatorio alrededor del valor base, con algún pico de vez en cuando
      const spike = Math.random() < 0.05 ? c.cpu * 3 : 0;
      c.curCpu = Math.max(0.1, c.curCpu + (c.cpu - c.curCpu) * 0.3 + (Math.random() - 0.5) * c.cpu * 0.6 + spike);
      c.curMem = Math.min(c.limit * 0.95, Math.max(c.mem * 0.7, c.curMem + (Math.random() - 0.48) * c.mem * 0.03));
      c.rx += rnd(1, 60) * 1024 * (c.cpu / 2);
      c.tx += rnd(1, 40) * 1024 * (c.cpu / 2);
      return { cpu: c.curCpu, memUsed: c.curMem * MB, memLimit: c.limit * MB, netRx: c.rx, netTx: c.tx };
    },

    async action(id, action) {
      const c = find(id);
      if (action === "start" && c.startedAt) throw new DockerError("container already started", 409);
      if (action === "stop" && !c.startedAt) throw new DockerError("container already stopped", 409);
      if (action === "stop") {
        c.startedAt = null;
        c.finishedAt = now();
      } else {
        c.startedAt = now();
        c.finishedAt = null;
        c.curCpu = c.cpu * 2.5; // pico de arranque
      }
    },

    async logs(id, tail = 200) {
      const c = find(id);
      const n = Math.min(tail, 60);
      const end = c.startedAt ? now() : c.finishedAt;
      const lines = [];
      let t = end;
      for (let i = 0; i < n; i++) {
        t -= rnd(2000, 9000);
        lines.unshift(`${new Date(t).toISOString()} ${LOGS[c.log]()}`);
      }
      if (!c.startedAt) lines.push(`${new Date(end).toISOString()} recibida señal SIGTERM, cerrando…`);
      return lines.join("\n") + "\n";
    },
  };
}
