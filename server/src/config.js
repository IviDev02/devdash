import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// .env opcional en la raíz del proyecto
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {}

const env = process.env;

export const config = {
  port: Number(env.PORT) || 4100,
  host: env.HOST || "127.0.0.1",
  githubUser: env.GITHUB_USER || "IviDev02",
  githubToken: env.GITHUB_TOKEN || "",
  dockerHost: env.DOCKER_HOST || "",
  dockerMode: env.DOCKER_MODE || "auto",
  readonly: env.READONLY === "true",
  pollMs: Number(env.POLL_MS) || 2000,
  clientDist: path.join(root, "client/dist"),
};
