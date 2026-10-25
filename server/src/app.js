import fs from "node:fs";
import path from "node:path";
import express from "express";

const ACTIONS = new Set(["start", "stop", "restart"]);
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

export function createApp({ github, engine, monitor, defaultUser, readonly = false, clientDist }) {
  const app = express();
  app.disable("x-powered-by");

  app.get("/api/status", async (req, res) => {
    let docker = { mode: engine.mode, readonly, connected: true };
    try {
      docker = { ...docker, ...(await engine.info()) };
    } catch (err) {
      docker = { ...docker, connected: false, error: err.message };
    }
    res.json({ docker, github: { defaultUser, rateLimit: github.rateLimit } });
  });

  app.get("/api/github/:username", async (req, res) => {
    res.json(await github.overview(req.params.username));
  });

  app.get("/api/docker/containers", async (req, res) => {
    // Si nadie está suscrito al stream no hay datos frescos: se leen al momento
    if (!monitor.clientCount) await monitor.poll();
    res.json(monitor.snapshot());
  });

  app.get("/api/docker/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // que Nginx no acumule los eventos
    });
    res.write("retry: 3000\n\n");
    const unsubscribe = monitor.subscribe(res);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.get("/api/docker/containers/:id/logs", async (req, res) => {
    const { id } = req.params;
    if (!ID_RE.test(id)) return res.status(400).json({ error: "Id de contenedor no válido" });
    const tail = Math.min(Math.max(Number(req.query.tail) || 200, 1), 1000);
    res.json({ logs: await engine.logs(id, tail) });
  });

  app.post("/api/docker/containers/:id/:action", async (req, res) => {
    const { id, action } = req.params;
    // Una cabecera propia obliga al navegador a hacer preflight CORS, así que
    // otra web abierta en tu navegador no puede parar tus contenedores.
    if (req.get("x-devdash") !== "1") return res.status(403).json({ error: "Falta la cabecera X-DevDash" });
    if (readonly) return res.status(403).json({ error: "El dashboard está en modo solo lectura" });
    if (!ID_RE.test(id)) return res.status(400).json({ error: "Id de contenedor no válido" });
    if (!ACTIONS.has(action)) return res.status(400).json({ error: "Acción no válida" });
    await engine.action(id, action);
    const snapshot = await monitor.poll().catch(() => monitor.snapshot());
    res.json({ ok: true, container: snapshot.containers.find((c) => c.id === id || c.name === id) ?? null });
  });

  app.use("/api", (req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

  if (clientDist && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { maxAge: "1h", index: false }));
    app.get("/{*splat}", (req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  app.use((err, req, res, next) => {
    const status = err.status ?? 500;
    if (status >= 500 && status !== 502) console.error(err);
    res.status(status).json({ error: status === 500 ? "Error interno" : err.message, ...(err.reset ? { reset: err.reset } : {}) });
  });

  return app;
}
