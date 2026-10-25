import { test } from "node:test";
import assert from "node:assert/strict";
import { buildActivity, buildLanguages, buildOverview, createGitHub, summarizeEvent } from "../src/github.js";

const NOW = Date.parse("2026-10-25T12:00:00Z");

function ev(type, daysAgo, payload = {}) {
  return { id: String(Math.random()), type, created_at: new Date(NOW - daysAgo * 86400000).toISOString(), repo: { name: "u/repo" }, payload };
}

test("buildActivity agrupa por día y tipo y descarta lo antiguo", () => {
  const days = buildActivity([ev("PushEvent", 0), ev("PushEvent", 0), ev("PullRequestEvent", 1), ev("WatchEvent", 1), ev("PushEvent", 45)], { now: NOW });
  assert.equal(days.length, 30);
  assert.equal(days.at(-1).date, "2026-10-25");
  assert.deepEqual(days.at(-1), { date: "2026-10-25", push: 2, pr: 0, issue: 0, other: 0 });
  assert.deepEqual(days.at(-2), { date: "2026-10-24", push: 0, pr: 1, issue: 0, other: 1 });
  assert.equal(days.reduce((a, d) => a + d.push, 0), 2);
});

test("buildLanguages pondera por tamaño, ignora forks y agrupa el resto", () => {
  const repos = [
    { language: "JavaScript", size: 300, fork: false },
    { language: "JavaScript", size: 100, fork: false },
    { language: "CSS", size: 100, fork: false },
    { language: "Go", size: 5000, fork: true },
    { language: null, size: 50, fork: false },
  ];
  const langs = buildLanguages(repos);
  assert.deepEqual(langs.map((l) => l.name), ["JavaScript", "CSS"]);
  assert.equal(langs[0].share, 0.8);
  assert.equal(langs[0].repos, 2);

  const many = ["A", "B", "C", "D", "E", "F", "G", "H"].map((language, i) => ({ language, size: 100 - i, fork: false }));
  const top = buildLanguages(many, 6);
  assert.equal(top.length, 7);
  assert.equal(top.at(-1).name, "Otros");
  assert.equal(top.at(-1).repos, 2);
  assert.ok(Math.abs(top.reduce((a, l) => a + l.share, 0) - 1) < 1e-9);
});

test("summarizeEvent describe los eventos en castellano", () => {
  assert.equal(summarizeEvent(ev("PushEvent", 0, { ref: "refs/heads/main" })), "Push a main");
  assert.equal(summarizeEvent(ev("PullRequestEvent", 0, { action: "closed", number: 7, pull_request: { merged: true } })), "PR #7 fusionada");
  assert.equal(summarizeEvent(ev("CreateEvent", 0, { ref_type: "repository" })), "Repositorio creado");
  assert.equal(summarizeEvent(ev("GollumEvent", 0)), "Gollum");
});

test("buildOverview calcula totales y racha sin contar forks", () => {
  const user = { login: "u", public_repos: 3, followers: 5, following: 1 };
  const repos = [
    { name: "a", stargazers_count: 4, forks_count: 1, fork: false, pushed_at: "2026-10-01", size: 1, language: "JS" },
    { name: "b", stargazers_count: 10, forks_count: 2, fork: false, pushed_at: "2026-09-01", size: 1, language: "JS" },
    { name: "c", stargazers_count: 999, forks_count: 9, fork: true, pushed_at: "2026-10-02", size: 1, language: "JS" },
  ];
  // Hoy sin actividad, ayer y anteayer sí, hace 4 días también (hueco en medio)
  const events = [ev("PushEvent", 1), ev("PushEvent", 2), ev("IssuesEvent", 4)];
  const o = buildOverview({ user, repos, events, now: NOW });
  assert.equal(o.totals.stars, 14);
  assert.equal(o.totals.forks, 3);
  assert.equal(o.totals.streak, 2);
  assert.equal(o.totals.activeDays, 3);
  assert.equal(o.totals.events30d, 3);
  assert.deepEqual(o.topRepos.map((r) => r.name), ["b", "a"]);
});

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, { headers }) => {
    calls.push({ url, headers });
    const path = url.replace("https://api.github.com", "");
    const route = routes(path, headers);
    return new Response(route.status === 304 ? null : JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { etag: route.etag ?? "", "x-ratelimit-limit": "60", "x-ratelimit-remaining": String(route.remaining ?? 59), "x-ratelimit-reset": "1800000000" },
    });
  };
  fn.calls = calls;
  return fn;
}

const okRoutes = (path, headers) => {
  if (path === "/users/u") return headers["If-None-Match"] === '"v1"' ? { status: 304 } : { body: { login: "u", public_repos: 0 }, etag: '"v1"' };
  return { body: [] };
};

test("createGitHub cachea dentro del TTL y revalida con ETag", async () => {
  let now = NOW;
  const fetch = fakeFetch(okRoutes);
  const gh = createGitHub({ fetch, now: () => now, ttlMs: 1000 });

  await gh.overview("u");
  const first = fetch.calls.length;
  assert.equal(first, 3); // usuario, repos y eventos

  await gh.overview("u");
  assert.equal(fetch.calls.length, first, "dentro del TTL no se llama a GitHub");

  now += 2000;
  const o = await gh.overview("u");
  assert.equal(o.profile.login, "u");
  const userCall = fetch.calls.slice(first).find((c) => c.url.endsWith("/users/u"));
  assert.equal(userCall.headers["If-None-Match"], '"v1"');
  assert.equal(gh.rateLimit.remaining, 59);
});

test("createGitHub traduce 404, límite agotado y nombres inválidos", async () => {
  const gh404 = createGitHub({ fetch: fakeFetch(() => ({ status: 404, body: { message: "Not Found" } })) });
  await assert.rejects(gh404.overview("nadie"), { status: 404 });

  const ghLimit = createGitHub({ fetch: fakeFetch(() => ({ status: 403, remaining: 0 })) });
  await assert.rejects(ghLimit.overview("u"), (err) => err.status === 429 && err.reset === 1800000000000);

  await assert.rejects(gh404.overview("-mal-"), { status: 400 });
  await assert.rejects(gh404.overview("a/../../x"), { status: 400 });
});
