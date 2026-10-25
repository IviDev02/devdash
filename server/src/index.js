import http from "node:http";
import { config } from "./config.js";
import { createApp } from "./app.js";
import { createDockerEngine } from "./docker.js";
import { createDemoEngine } from "./demoDocker.js";
import { createGitHub } from "./github.js";
import { createMonitor } from "./monitor.js";

// Docker real si responde; si no (y no se ha forzado), contenedores de demo
async function selectEngine() {
  if (config.dockerMode === "demo") return createDemoEngine();
  const docker = createDockerEngine({ dockerHost: config.dockerHost });
  const ok = await docker.ping().catch(() => false);
  if (ok || config.dockerMode === "docker") return docker;
  console.log("ℹ No se ha encontrado Docker: se muestran contenedores de demo (DOCKER_MODE=docker para forzarlo)");
  return createDemoEngine();
}

const engine = await selectEngine();
const monitor = createMonitor(engine, { pollMs: config.pollMs });
const github = createGitHub({ token: config.githubToken });

const app = createApp({
  github,
  engine,
  monitor,
  defaultUser: config.githubUser,
  readonly: config.readonly,
  clientDist: config.clientDist,
});
const server = http.createServer(app);

server.listen(config.port, config.host, () => {
  const shown = config.host === "0.0.0.0" ? "localhost" : config.host;
  console.log(`✔ DevDash en http://${shown}:${config.port}`);
  console.log(`  Docker: ${engine.mode === "demo" ? "modo demo" : "conectado"} · GitHub: ${config.githubToken ? "con token" : "sin token (60 peticiones/hora)"}`);
});

const shutdown = () => {
  monitor.close();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
