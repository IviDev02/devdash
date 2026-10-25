import http from "node:http";

// Dónde escucha el Docker Engine según DOCKER_HOST y el sistema operativo
export function resolveDockerHost(dockerHost = "", platform = process.platform) {
  if (dockerHost.startsWith("tcp://") || dockerHost.startsWith("http://")) {
    const url = new URL(dockerHost.replace(/^tcp:/, "http:"));
    return { host: url.hostname, port: Number(url.port) || 2375 };
  }
  if (dockerHost.startsWith("unix://")) return { socketPath: dockerHost.slice("unix://".length) };
  // npipe:////./pipe/docker_engine -> \\.\pipe\docker_engine
  if (dockerHost.startsWith("npipe://")) return { socketPath: dockerHost.slice("npipe://".length).replace(/\//g, "\\") };
  return platform === "win32" ? { socketPath: "\\\\.\\pipe\\docker_engine" } : { socketPath: "/var/run/docker.sock" };
}

export class DockerError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// Los logs de un contenedor sin TTY llegan multiplexados: cada trozo lleva una
// cabecera de 8 bytes [stream, 0, 0, 0, tamaño (uint32 BE)] seguida del texto.
export function demuxLogs(buf) {
  const looksMultiplexed = buf.length >= 8 && buf[0] <= 2 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
  if (!looksMultiplexed) return buf.toString("utf8");
  let out = "";
  let i = 0;
  while (i + 8 <= buf.length) {
    const size = buf.readUInt32BE(i + 4);
    out += buf.toString("utf8", i + 8, i + 8 + size);
    i += 8 + size;
  }
  return out;
}

// % de CPU como lo calcula `docker stats`, a partir de dos muestras consecutivas
export function cpuPercent(cur, prev) {
  if (!cur?.cpu_usage || !prev?.cpu_usage) return 0;
  const cpuDelta = cur.cpu_usage.total_usage - prev.cpu_usage.total_usage;
  const systemDelta = (cur.system_cpu_usage ?? 0) - (prev.system_cpu_usage ?? 0);
  const cpus = cur.online_cpus || cur.cpu_usage.percpu_usage?.length || 1;
  if (cpuDelta <= 0 || systemDelta <= 0) return 0;
  return (cpuDelta / systemDelta) * cpus * 100;
}

// Memoria "real": se descuenta la caché de ficheros (cgroup v2: inactive_file, v1: cache)
export function memoryUsage(mem = {}) {
  const cache = mem.stats?.inactive_file ?? mem.stats?.total_inactive_file ?? mem.stats?.cache ?? 0;
  return { used: Math.max(0, (mem.usage ?? 0) - cache), limit: mem.limit ?? 0 };
}

function networkTotals(networks = {}) {
  let rx = 0;
  let tx = 0;
  for (const n of Object.values(networks)) {
    rx += n.rx_bytes ?? 0;
    tx += n.tx_bytes ?? 0;
  }
  return { rx, tx };
}

export function normalizeContainer(c) {
  return {
    id: c.Id.slice(0, 12),
    name: (c.Names?.[0] ?? c.Id.slice(0, 12)).replace(/^\//, ""),
    image: c.Image,
    state: c.State,
    status: c.Status,
    created: c.Created * 1000,
    project: c.Labels?.["com.docker.compose.project"] ?? null,
    ports: [...new Set((c.Ports ?? []).filter((p) => p.PublicPort).map((p) => `${p.PublicPort}:${p.PrivatePort}`))],
  };
}

// Cliente mínimo del Docker Engine API sobre el socket local (sin dependencias)
export function createDockerEngine({ dockerHost } = {}) {
  const target = resolveDockerHost(dockerHost);
  const prevCpu = new Map();

  function request(method, path, { timeout = 5000, raw = false } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ ...target, method, path, timeout, headers: { Host: "docker" } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode >= 400) {
            let message = `Docker respondió ${res.statusCode}`;
            try {
              message = JSON.parse(buf.toString()).message || message;
            } catch {}
            return reject(new DockerError(message, res.statusCode === 404 ? 404 : res.statusCode === 409 ? 409 : 502));
          }
          if (raw) return resolve(buf);
          if (!buf.length) return resolve(null);
          try {
            resolve(JSON.parse(buf.toString()));
          } catch {
            resolve(buf.toString());
          }
        });
      });
      req.on("timeout", () => req.destroy(new DockerError("Docker no responde")));
      req.on("error", (err) => reject(err instanceof DockerError ? err : new DockerError(`No se puede conectar con Docker (${err.code || err.message})`)));
      req.end();
    });
  }

  return {
    mode: "docker",

    async ping() {
      return (await request("GET", "/_ping", { timeout: 1500 })) === "OK";
    },

    async info() {
      const v = await request("GET", "/version");
      return { engine: v.Version, os: v.Os, arch: v.Arch };
    },

    async listContainers() {
      const list = await request("GET", "/containers/json?all=true");
      return list.map(normalizeContainer).sort((a, b) => a.name.localeCompare(b.name));
    },

    async stats(id) {
      const s = await request("GET", `/containers/${id}/stats?stream=false&one-shot=true`);
      const cpu = cpuPercent(s.cpu_stats, prevCpu.get(id));
      prevCpu.set(id, s.cpu_stats);
      const mem = memoryUsage(s.memory_stats);
      const net = networkTotals(s.networks);
      return { cpu, memUsed: mem.used, memLimit: mem.limit, netRx: net.rx, netTx: net.tx };
    },

    async action(id, action) {
      await request("POST", `/containers/${id}/${action}`, { timeout: 20000 });
    },

    async logs(id, tail = 200) {
      const buf = await request("GET", `/containers/${id}/logs?stdout=true&stderr=true&timestamps=true&tail=${tail}`, { raw: true });
      return demuxLogs(buf);
    },
  };
}
