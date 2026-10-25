import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Icon from "./Icon.jsx";
import StatTile from "./StatTile.jsx";
import LogsModal from "./LogsModal.jsx";
import { api } from "../lib/api.js";
import { CHART, clockTime, formatBytes, formatPercent, formatRate, translateStatus } from "../lib/format.js";

const MAX_LINES = 5;
const FILTERS = [
  { key: "all", label: "Todos" },
  { key: "running", label: "En marcha" },
  { key: "stopped", label: "Parados" },
];

function Sparkline({ points, color }) {
  if (points.length < 2) return <svg className="spark" viewBox="0 0 100 28" />;
  const max = Math.max(...points, 1);
  const step = 100 / (points.length - 1);
  const coords = points.map((v, i) => `${(i * step).toFixed(1)},${(26 - (v / max) * 24).toFixed(1)}`);
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none">
      <polygon points={`0,28 ${coords.join(" ")} 100,28`} fill={color} opacity="0.15" />
      <polyline points={coords.join(" ")} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MetricTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tt-title">{clockTime(label)}</div>
      {payload
        .slice()
        .sort((a, b) => b.value - a.value)
        .map((p) => (
          <div key={p.dataKey} className="tt-row">
            <span className="dot" style={{ background: p.color }} />
            {p.dataKey}
            <b>{metric === "cpu" ? formatPercent(p.value) : formatBytes(p.value)}</b>
          </div>
        ))}
    </div>
  );
}

// Las 5 series con más consumo, en filas por instante para Recharts. El color
// sale de la posición en la lista para que no cambie cuando cambia el ranking.
function useChartData(containers, history, metric) {
  return useMemo(() => {
    const colorOf = new Map(containers.map((c, i) => [c.id, CHART.series[i % CHART.series.length]]));
    const running = containers.filter((c) => c.stats);
    const top = running
      .slice()
      .sort((a, b) => (metric === "cpu" ? b.stats.cpu - a.stats.cpu : b.stats.memUsed - a.stats.memUsed))
      .slice(0, MAX_LINES);
    const rows = new Map();
    for (const c of top) {
      for (const p of history[c.id] ?? []) {
        const row = rows.get(p.t) ?? { t: p.t };
        row[c.name] = p[metric];
        rows.set(p.t, row);
      }
    }
    return {
      series: top.map((c) => ({ name: c.name, color: colorOf.get(c.id) })),
      rows: [...rows.values()].sort((a, b) => a.t - b.t),
    };
  }, [containers, history, metric]);
}

function UsageChart({ containers, history }) {
  const [metric, setMetric] = useState("cpu");
  const { series, rows } = useChartData(containers, history, metric);

  return (
    <div className="panel span-3">
      <div className="panel-head">
        <h3>{metric === "cpu" ? "CPU" : "Memoria"} en directo · top {MAX_LINES}</h3>
        <div className="segmented">
          <button className={metric === "cpu" ? "active" : ""} onClick={() => setMetric("cpu")}>
            CPU
          </button>
          <button className={metric === "mem" ? "active" : ""} onClick={() => setMetric("mem")}>
            Memoria
          </button>
        </div>
      </div>
      <div className="chart" style={{ height: 220 }}>
        {rows.length < 2 ? (
          <p className="empty">Recogiendo métricas…</p>
        ) : (
          <ResponsiveContainer>
            <LineChart data={rows} margin={{ top: 8, right: 8, left: metric === "cpu" ? -18 : 6, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={CHART.grid} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={clockTime} tick={{ fill: CHART.axis, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
              <YAxis tickFormatter={(v) => (metric === "cpu" ? `${v}%` : formatBytes(v, 0))} tick={{ fill: CHART.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={metric === "cpu" ? 50 : 60} />
              <Tooltip content={<MetricTooltip metric={metric} />} />
              {series.map((s) => (
                <Line key={s.name} dataKey={s.name} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      {series.length > 0 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ContainerRow({ c, history, busy, readonly, onAction, onLogs }) {
  const running = c.state === "running";
  const s = c.stats;
  const memPct = s && s.memLimit ? (s.memUsed / s.memLimit) * 100 : 0;
  const cpuPoints = (history ?? []).map((p) => p.cpu);

  return (
    <div className={`container-row ${running ? "" : "is-stopped"}`}>
      <div className="c-name">
        <span className={`status-dot ${c.state}`} title={c.state} />
        <div>
          <div className="name">
            {c.name}
            {c.project && <span className="chip">{c.project}</span>}
          </div>
          <div className="muted small mono">{c.image}</div>
        </div>
      </div>
      <div className="c-status small">
        <div>{translateStatus(c.status)}</div>
        {c.ports.length > 0 && (
          <div className="ports">
            {c.ports.map((p) => (
              <a key={p} className="port" href={`http://localhost:${p.split(":")[0]}`} target="_blank" rel="noreferrer">
                :{p.split(":")[0]}
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="c-metric">
        <span className="metric-label">CPU</span>
        <div className="metric-value">{s ? formatPercent(s.cpu) : "—"}</div>
        <Sparkline points={cpuPoints} color={CHART.push} />
      </div>
      <div className="c-metric">
        <span className="metric-label">Memoria</span>
        <div className="metric-value">{s ? formatBytes(s.memUsed) : "—"}</div>
        <div className="bar">
          <span style={{ width: `${Math.min(memPct, 100)}%` }} className={memPct > 85 ? "hot" : ""} />
        </div>
        {s && <span className="muted tiny">de {formatBytes(s.memLimit)}</span>}
      </div>
      <div className="c-metric">
        <span className="metric-label">Red</span>
        {s ? (
          <div className="net small">
            <span>
              <Icon name="arrowDown" size={11} /> {formatRate(s.netRxRate)}
            </span>
            <span>
              <Icon name="arrowUp" size={11} /> {formatRate(s.netTxRate)}
            </span>
          </div>
        ) : (
          <div className="metric-value">—</div>
        )}
      </div>
      <div className="c-actions">
        {!readonly &&
          (running ? (
            <>
              <button className="icon-btn" title="Reiniciar" disabled={busy} onClick={() => onAction(c, "restart")}>
                <Icon name="restart" className={busy === "restart" ? "spin" : ""} />
              </button>
              <button className="icon-btn danger" title="Parar" disabled={busy} onClick={() => onAction(c, "stop")}>
                <Icon name="stop" size={14} />
              </button>
            </>
          ) : (
            <button className="icon-btn ok" title="Arrancar" disabled={busy} onClick={() => onAction(c, "start")}>
              <Icon name="play" size={14} className={busy === "start" ? "pulse" : ""} />
            </button>
          ))}
        <button className="icon-btn" title="Ver logs" onClick={() => onLogs(c)}>
          <Icon name="logs" />
        </button>
      </div>
    </div>
  );
}

export default function DockerSection({ stream, status, notify }) {
  const { containers, history, error, connected, updatedAt, patch } = stream;
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState({});
  const [logsFor, setLogsFor] = useState(null);
  const readonly = status?.docker.readonly;

  const list = containers ?? [];
  const running = list.filter((c) => c.state === "running");
  const totals = running.reduce(
    (a, c) => ({
      cpu: a.cpu + (c.stats?.cpu ?? 0),
      mem: a.mem + (c.stats?.memUsed ?? 0),
      net: a.net + (c.stats ? c.stats.netRxRate + c.stats.netTxRate : 0),
    }),
    { cpu: 0, mem: 0, net: 0 },
  );

  const visible = list.filter((c) => {
    if (filter === "running" && c.state !== "running") return false;
    if (filter === "stopped" && c.state === "running") return false;
    const q = query.trim().toLowerCase();
    return !q || [c.name, c.image, c.project ?? ""].some((v) => v.toLowerCase().includes(q));
  });

  async function runAction(c, action) {
    setBusy((b) => ({ ...b, [c.id]: action }));
    try {
      const res = await api(`/docker/containers/${c.id}/${action}`, { method: "POST" });
      patch(res.container);
      notify(`${c.name}: ${{ start: "arrancado", stop: "parado", restart: "reiniciado" }[action]}`);
    } catch (err) {
      notify(`${c.name}: ${err.message}`, "error");
    } finally {
      setBusy(({ [c.id]: _, ...rest }) => rest);
    }
  }

  const modeLabel = status?.docker.mode === "demo" ? "Modo demo" : status?.docker.engine ? `Engine ${status.docker.engine}` : "Docker";

  return (
    <section className="section">
      <div className="section-head">
        <h2>
          <Icon name="docker" size={20} /> Contenedores
          <span className={`badge ${status?.docker.mode === "demo" ? "badge-warn" : ""}`}>{modeLabel}</span>
        </h2>
        <span className="live small">
          <span className={`live-dot ${connected ? "on" : ""}`} />
          {connected ? `En directo${updatedAt ? ` · ${clockTime(updatedAt)}` : ""}` : "Reconectando…"}
        </span>
      </div>

      {status?.docker.mode === "demo" && (
        <div className="alert info">
          <Icon name="docker" />
          <span>
            No se ha encontrado Docker en este equipo, así que se muestran <b>contenedores simulados</b>. Arranca Docker Desktop y reinicia DevDash para ver los
            tuyos.
          </span>
        </div>
      )}
      {error && (
        <div className="alert">
          <Icon name="alert" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid">
        <div className="tiles span-3 tiles-4">
          <StatTile icon="box" label="En marcha" value={`${running.length}/${list.length}`} hint={`${list.length - running.length} parados`} tone="teal" />
          <StatTile icon="cpu" label="CPU total" value={formatPercent(totals.cpu)} hint="suma de todos los contenedores" />
          <StatTile icon="memory" label="Memoria" value={formatBytes(totals.mem)} hint="en uso ahora mismo" tone="purple" />
          <StatTile icon="arrowDown" label="Red" value={formatRate(totals.net)} hint="entrada + salida" tone="blue" />
        </div>

        <UsageChart containers={list} history={history} />

        <div className="panel span-3 containers">
          <div className="panel-head">
            <div className="segmented">
              {FILTERS.map((f) => (
                <button key={f.key} className={filter === f.key ? "active" : ""} onClick={() => setFilter(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
            <label className="search">
              <Icon name="search" size={14} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, imagen o proyecto" />
            </label>
          </div>

          {containers === null ? (
            <p className="empty">Conectando con Docker…</p>
          ) : visible.length === 0 ? (
            <p className="empty">{list.length ? "Ningún contenedor coincide con el filtro." : "No hay contenedores. Prueba con docker run hello-world."}</p>
          ) : (
            visible.map((c) => (
              <ContainerRow key={c.id} c={c} history={history[c.id]} busy={busy[c.id]} readonly={readonly} onAction={runAction} onLogs={setLogsFor} />
            ))
          )}
        </div>
      </div>

      {logsFor && <LogsModal container={logsFor} onClose={() => setLogsFor(null)} />}
    </section>
  );
}
