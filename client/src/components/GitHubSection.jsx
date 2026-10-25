import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Icon from "./Icon.jsx";
import StatTile from "./StatTile.jsx";
import { CHART, formatNumber, langColor, shortDate, timeAgo } from "../lib/format.js";

const SERIES = [
  { key: "push", label: "Push", color: CHART.push },
  { key: "pr", label: "Pull requests", color: CHART.pr },
  { key: "issue", label: "Issues", color: CHART.issue },
  { key: "other", label: "Otros", color: CHART.other },
];

function ActivityTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((a, p) => a + p.value, 0);
  return (
    <div className="chart-tooltip">
      <div className="tt-title">{shortDate(label)}</div>
      {total === 0 && <div className="muted">Sin actividad</div>}
      {payload
        .filter((p) => p.value > 0)
        .map((p) => (
          <div key={p.dataKey} className="tt-row">
            <span className="dot" style={{ background: p.color }} />
            {SERIES.find((s) => s.key === p.dataKey).label}
            <b>{p.value}</b>
          </div>
        ))}
    </div>
  );
}

function ActivityChart({ activity }) {
  return (
    <div className="panel span-2">
      <div className="panel-head">
        <h3>Actividad pública · últimos 30 días</h3>
        <div className="legend">
          {SERIES.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="chart" style={{ height: 230 }}>
        <ResponsiveContainer>
          <BarChart data={activity} margin={{ top: 8, right: 4, left: -24, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: CHART.axis, fontSize: 11 }} axisLine={false} tickLine={false} interval={4} />
            <YAxis allowDecimals={false} tick={{ fill: CHART.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ActivityTooltip />} cursor={{ fill: CHART.hover }} />
            {SERIES.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} radius={i === SERIES.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LanguagesChart({ languages }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Lenguajes</h3>
        <span className="muted small">por tamaño de repo</span>
      </div>
      {languages.length === 0 ? (
        <p className="empty">Sin repositorios propios con código.</p>
      ) : (
        <div className="langs">
          <div className="donut">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={languages} dataKey="share" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {languages.map((l, i) => (
                    <Cell key={l.name} fill={langColor(l.name, i)} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <b>{languages[0].name}</b>
              <span>{Math.round(languages[0].share * 100)}%</span>
            </div>
          </div>
          <ul className="lang-list">
            {languages.map((l, i) => (
              <li key={l.name}>
                <i style={{ background: langColor(l.name, i) }} />
                <span className="lang-name">{l.name}</span>
                <span className="muted small">{l.repos} {l.repos === 1 ? "repo" : "repos"}</span>
                <b>{(l.share * 100).toFixed(l.share < 0.1 ? 1 : 0)}%</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TopRepos({ repos }) {
  return (
    <div className="panel span-2">
      <div className="panel-head">
        <h3>Repositorios destacados</h3>
      </div>
      {repos.length === 0 ? (
        <p className="empty">Todavía no hay repositorios públicos.</p>
      ) : (
        <div className="repos">
          {repos.map((r, i) => (
            <a key={r.name} className="repo" href={r.url} target="_blank" rel="noreferrer">
              <div className="repo-name">
                <Icon name="repo" size={14} />
                {r.name}
              </div>
              <p>{r.description || <span className="muted">Sin descripción</span>}</p>
              <div className="repo-meta">
                {r.language && (
                  <span>
                    <i style={{ background: langColor(r.language, i) }} />
                    {r.language}
                  </span>
                )}
                <span>
                  <Icon name="star" size={12} /> {r.stars}
                </span>
                <span>
                  <Icon name="fork" size={12} /> {r.forks}
                </span>
                <span className="muted">{timeAgo(r.pushedAt)}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentEvents({ events }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Últimos movimientos</h3>
      </div>
      {events.length === 0 ? (
        <p className="empty">Sin actividad pública reciente.</p>
      ) : (
        <ul className="events">
          {events.map((e) => (
            <li key={e.id}>
              <span className="dot" style={{ background: `var(--c-${e.type})` }} />
              <div>
                <div className="event-summary">{e.summary}</div>
                <a className="muted small" href={`https://github.com/${e.repo}`} target="_blank" rel="noreferrer">
                  {e.repo}
                </a>
              </div>
              <time className="muted small" dateTime={e.createdAt}>
                {timeAgo(e.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid">
      <div className="panel span-3 skeleton" style={{ height: 120 }} />
      <div className="panel span-2 skeleton" style={{ height: 290 }} />
      <div className="panel skeleton" style={{ height: 290 }} />
    </div>
  );
}

export default function GitHubSection({ data, error, loading, reload }) {
  const p = data?.profile;
  const t = data?.totals;

  return (
    <section className="section">
      <div className="section-head">
        <h2>
          <Icon name="github" size={20} /> GitHub
        </h2>
        <div className="row">
          {data && (
            <span className="muted small">
              Actualizado {timeAgo(data.fetchedAt)}
              {data.rateLimit.remaining != null && ` · ${data.rateLimit.remaining}/${data.rateLimit.limit} peticiones libres`}
            </span>
          )}
          <button className="icon-btn" onClick={reload} title="Actualizar" disabled={loading}>
            <Icon name="refresh" className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {error && (
        <div className="alert">
          <Icon name="alert" />
          <span>
            {error.message}
            {error.body?.reset && ` · se renueva ${timeAgo(error.body.reset)}. Añade un GITHUB_TOKEN en el .env para tener 5.000 peticiones/hora.`}
          </span>
        </div>
      )}

      {!data && loading && <Skeleton />}

      {data && (
        <div className="grid">
          <div className="panel profile">
            <img src={p.avatar} alt="" width="64" height="64" />
            <div>
              <a className="profile-name" href={p.url} target="_blank" rel="noreferrer">
                {p.name || p.login} <Icon name="external" size={13} />
              </a>
              <div className="muted small">@{p.login}</div>
              {p.bio && <p className="bio">{p.bio}</p>}
              <div className="profile-meta muted small">
                {p.location && (
                  <span>
                    <Icon name="pin" size={12} /> {p.location}
                  </span>
                )}
                <span>
                  <Icon name="users" size={12} /> {formatNumber(t.followers)} seguidores · {formatNumber(t.following)} seguidos
                </span>
              </div>
            </div>
          </div>
          <div className="tiles span-2">
            <StatTile icon="repo" label="Repos públicos" value={formatNumber(t.repos)} hint={`en GitHub desde ${new Date(p.createdAt).getFullYear()}`} />
            <StatTile icon="star" label="Estrellas" value={formatNumber(t.stars)} hint={`${formatNumber(t.forks)} forks`} tone="warn" />
            <StatTile icon="github" label="Eventos (30 d)" value={formatNumber(t.events30d)} hint={`${t.activeDays} días con actividad`} tone="teal" />
            <StatTile icon="flame" label="Racha" value={`${t.streak} ${t.streak === 1 ? "día" : "días"}`} hint={t.streak ? "seguidos con actividad" : "¡hoy es buen día para un commit!"} tone="pink" />
          </div>

          <ActivityChart activity={data.activity} />
          <LanguagesChart languages={data.languages} />
          <TopRepos repos={data.topRepos} />
          <RecentEvents events={data.recentEvents} />
        </div>
      )}
    </section>
  );
}
