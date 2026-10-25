const API = "https://api.github.com";
const DAY = 86400000;

export class GitHubError extends Error {
  constructor(message, status = 502, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

export const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

const EVENT_GROUPS = {
  PushEvent: "push",
  PullRequestEvent: "pr",
  PullRequestReviewEvent: "pr",
  PullRequestReviewCommentEvent: "pr",
  IssuesEvent: "issue",
  IssueCommentEvent: "issue",
};

const ACTIONS = { opened: "abierta", closed: "cerrada", reopened: "reabierta" };

export function summarizeEvent(e) {
  const p = e.payload ?? {};
  switch (e.type) {
    case "PushEvent": {
      const branch = p.ref?.replace("refs/heads/", "");
      return branch ? `Push a ${branch}` : "Push";
    }
    case "PullRequestEvent": {
      const action = p.action === "closed" && p.pull_request?.merged ? "fusionada" : (ACTIONS[p.action] ?? p.action);
      return `PR #${p.number ?? p.pull_request?.number} ${action}`;
    }
    case "PullRequestReviewEvent":
      return `Revisión en PR #${p.pull_request?.number}`;
    case "IssuesEvent":
      return `Issue #${p.issue?.number} ${ACTIONS[p.action] ?? p.action}`;
    case "IssueCommentEvent":
      return `Comentario en #${p.issue?.number}`;
    case "CreateEvent":
      return p.ref_type === "repository" ? "Repositorio creado" : `${p.ref_type === "tag" ? "Tag" : "Rama"} ${p.ref} creada`;
    case "DeleteEvent":
      return `${p.ref_type === "tag" ? "Tag" : "Rama"} ${p.ref} borrada`;
    case "WatchEvent":
      return "Le dio una estrella";
    case "ForkEvent":
      return "Hizo un fork";
    case "ReleaseEvent":
      return `Release ${p.release?.tag_name ?? ""}`.trim();
    case "PublicEvent":
      return "Hizo público el repositorio";
    default:
      return e.type.replace(/Event$/, "");
  }
}

// Actividad diaria de los últimos `days` días (UTC), agrupada por tipo
export function buildActivity(events, { days = 30, now = Date.now() } = {}) {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const first = today.getTime() - (days - 1) * DAY;
  const buckets = Array.from({ length: days }, (_, i) => ({
    date: new Date(first + i * DAY).toISOString().slice(0, 10),
    push: 0,
    pr: 0,
    issue: 0,
    other: 0,
  }));
  for (const e of events) {
    const idx = Math.floor((Date.parse(e.created_at) - first) / DAY);
    if (idx < 0 || idx >= days) continue;
    buckets[idx][EVENT_GROUPS[e.type] ?? "other"]++;
  }
  return buckets;
}

// Reparto de lenguajes ponderado por el tamaño de cada repo (sin forks)
export function buildLanguages(repos, top = 6) {
  const totals = new Map();
  const counts = new Map();
  for (const r of repos) {
    if (r.fork || !r.language) continue;
    totals.set(r.language, (totals.get(r.language) ?? 0) + Math.max(r.size, 1));
    counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
  }
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  if (!sum) return [];
  const sorted = [...totals].sort((a, b) => b[1] - a[1]);
  const main = sorted.slice(0, top).map(([name, size]) => ({ name, share: size / sum, repos: counts.get(name) }));
  const rest = sorted.slice(top);
  if (rest.length) {
    main.push({
      name: "Otros",
      share: rest.reduce((a, [, s]) => a + s, 0) / sum,
      repos: rest.reduce((a, [name]) => a + counts.get(name), 0),
    });
  }
  return main;
}

const total = (d) => d.push + d.pr + d.issue + d.other;

export function buildOverview({ user, repos, events, now = Date.now() }) {
  const own = repos.filter((r) => !r.fork);
  const activity = buildActivity(events, { now });

  // Racha: días seguidos con actividad hasta hoy (si hoy aún no hay nada, cuenta desde ayer)
  let streak = 0;
  for (let i = activity.length - 1; i >= 0; i--) {
    if (total(activity[i]) > 0) streak++;
    else if (i < activity.length - 1) break;
  }

  return {
    profile: {
      login: user.login,
      name: user.name,
      avatar: user.avatar_url,
      bio: user.bio,
      location: user.location,
      company: user.company,
      url: user.html_url,
      createdAt: user.created_at,
    },
    totals: {
      repos: user.public_repos,
      stars: own.reduce((a, r) => a + r.stargazers_count, 0),
      forks: own.reduce((a, r) => a + r.forks_count, 0),
      followers: user.followers,
      following: user.following,
      events30d: activity.reduce((a, d) => a + total(d), 0),
      activeDays: activity.filter((d) => total(d) > 0).length,
      streak,
    },
    activity,
    languages: buildLanguages(repos),
    topRepos: own
      .slice()
      .sort((a, b) => b.stargazers_count - a.stargazers_count || Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
      .slice(0, 6)
      .map((r) => ({
        name: r.name,
        description: r.description,
        url: r.html_url,
        language: r.language,
        stars: r.stargazers_count,
        forks: r.forks_count,
        issues: r.open_issues_count,
        pushedAt: r.pushed_at,
      })),
    recentEvents: events
      .slice()
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 12)
      .map((e) => ({
        id: e.id,
        type: EVENT_GROUPS[e.type] ?? "other",
        repo: e.repo.name,
        summary: summarizeEvent(e),
        createdAt: e.created_at,
      })),
  };
}

// Cliente de la API de GitHub con caché: dentro del TTL no se llama a GitHub y,
// pasado el TTL, se revalida con ETag (las respuestas 304 no gastan cuota).
export function createGitHub({ token = "", ttlMs = 5 * 60_000, fetch = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map();
  const rateLimit = { limit: token ? 5000 : 60, remaining: null, reset: null };

  async function get(path) {
    const hit = cache.get(path);
    if (hit && now() - hit.at < ttlMs) return hit.data;

    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "DevDash",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (hit?.etag) headers["If-None-Match"] = hit.etag;

    let res;
    try {
      res = await fetch(API + path, { headers, signal: AbortSignal.timeout(10_000) });
    } catch {
      if (hit) return hit.data; // sin conexión: mejor datos algo viejos que nada
      throw new GitHubError("No se puede conectar con GitHub", 502);
    }

    const h = (name) => res.headers.get(name);
    if (h("x-ratelimit-limit")) {
      rateLimit.limit = Number(h("x-ratelimit-limit"));
      rateLimit.remaining = Number(h("x-ratelimit-remaining"));
      rateLimit.reset = Number(h("x-ratelimit-reset")) * 1000;
    }

    if (res.status === 304 && hit) {
      hit.at = now();
      return hit.data;
    }
    if (res.status === 404) throw new GitHubError("Ese usuario no existe en GitHub", 404);
    if ((res.status === 403 || res.status === 429) && h("x-ratelimit-remaining") === "0") {
      if (hit) return hit.data;
      throw new GitHubError("Se ha agotado el límite de peticiones a GitHub", 429, { reset: rateLimit.reset });
    }
    if (res.status === 401) throw new GitHubError("El GITHUB_TOKEN no es válido", 502);
    if (!res.ok) throw new GitHubError(`GitHub respondió ${res.status}`, 502);

    const data = await res.json();
    cache.set(path, { data, etag: h("etag"), at: now() });
    return data;
  }

  async function paginate(path, maxPages) {
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const items = await get(`${path}${sep}per_page=100&page=${page}`);
      all.push(...items);
      if (items.length < 100) break;
    }
    return all;
  }

  return {
    get rateLimit() {
      return { ...rateLimit };
    },

    async overview(username) {
      if (!USERNAME_RE.test(username)) throw new GitHubError("Nombre de usuario no válido", 400);
      const u = encodeURIComponent(username);
      const user = await get(`/users/${u}`);
      const [repos, events] = await Promise.all([
        paginate(`/users/${u}/repos?sort=pushed`, 3),
        paginate(`/users/${u}/events/public`, 3).catch(() => []), // la actividad no es imprescindible
      ]);
      return { ...buildOverview({ user, repos, events, now: now() }), rateLimit: { ...rateLimit }, fetchedAt: now() };
    },
  };
}
