const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// Sondea Docker cada `pollMs` solo mientras haya alguien mirando el dashboard,
// guarda un histórico corto por contenedor y lo reparte por Server-Sent Events.
export function createMonitor(engine, { pollMs = 2000, historySize = 90 } = {}) {
  const clients = new Set();
  const history = new Map(); // id -> [{ t, cpu, mem }]
  const prevNet = new Map(); // id -> { t, rx, tx }
  let containers = [];
  let lastError = null;
  let timer = null;
  let inFlight = null;

  function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcast(event, data) {
    for (const res of clients) send(res, event, data);
  }

  async function collect() {
    const list = await engine.listContainers();
    const t = Date.now();
    const running = list.filter((c) => c.state === "running");
    const results = await Promise.allSettled(running.map((c) => engine.stats(c.id)));

    const stats = new Map();
    running.forEach((c, i) => {
      if (results[i].status !== "fulfilled") return;
      const s = results[i].value;
      const prev = prevNet.get(c.id);
      const secs = prev ? (t - prev.t) / 1000 : 0;
      const point = {
        cpu: round(s.cpu, 2),
        memUsed: Math.round(s.memUsed),
        memLimit: s.memLimit,
        netRxRate: secs > 0 ? Math.max(0, Math.round((s.netRx - prev.rx) / secs)) : 0,
        netTxRate: secs > 0 ? Math.max(0, Math.round((s.netTx - prev.tx) / secs)) : 0,
      };
      prevNet.set(c.id, { t, rx: s.netRx, tx: s.netTx });
      stats.set(c.id, point);

      const h = history.get(c.id) ?? [];
      h.push({ t, cpu: point.cpu, mem: point.memUsed });
      if (h.length > historySize) h.shift();
      history.set(c.id, h);
    });

    // Olvida los contenedores que ya no existen
    const ids = new Set(list.map((c) => c.id));
    for (const id of history.keys()) if (!ids.has(id)) history.delete(id);
    for (const id of prevNet.keys()) if (!stats.has(id)) prevNet.delete(id);

    containers = list.map((c) => ({ ...c, stats: stats.get(c.id) ?? null }));
    return { t, containers };
  }

  // Si ya hay una lectura en marcha se reutiliza en vez de lanzar otra
  function poll() {
    inFlight ??= collect()
      .then((tick) => {
        lastError = null;
        broadcast("tick", tick);
        return tick;
      })
      .catch((err) => {
        lastError = err.message;
        broadcast("failure", { message: err.message });
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => poll().catch(() => {}), pollMs);
    poll().catch(() => {});
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return {
    get clientCount() {
      return clients.size;
    },

    snapshot() {
      return { containers, history: Object.fromEntries(history), error: lastError };
    },

    poll,

    subscribe(res) {
      clients.add(res);
      send(res, "snapshot", this.snapshot());
      start();
      return () => {
        clients.delete(res);
        if (!clients.size) stop();
      };
    },

    close() {
      stop();
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
