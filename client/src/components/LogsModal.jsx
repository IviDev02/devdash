import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { api } from "../lib/api.js";

const TS_RE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s(.*)$/;
const LEVEL_RE = /\b(error|err|fatal|exception|fail(ed)?)\b/i;
const WARN_RE = /\b(warn(ing)?|slow)\b/i;

function parse(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line, i) => {
      const m = line.match(TS_RE);
      const msg = m ? m[2] : line;
      return {
        i,
        time: m ? new Date(m[1]).toLocaleTimeString("es") : null,
        msg,
        level: LEVEL_RE.test(msg) ? "error" : WARN_RE.test(msg) ? "warn" : "",
      };
    });
}

export default function LogsModal({ container, onClose }) {
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState("");
  const bodyRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api(`/docker/containers/${container.id}/logs?tail=300`)
        .then(({ logs }) => alive && (setText(logs), setError(null)))
        .catch((err) => alive && setError(err.message));
    load();
    const timer = follow ? setInterval(load, 3000) : null;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [container.id, follow]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lines = useMemo(() => {
    const all = parse(text);
    const q = filter.trim().toLowerCase();
    return q ? all.filter((l) => l.msg.toLowerCase().includes(q)) : all;
  }, [text, filter]);

  // Mantiene el scroll abajo mientras se siguen los logs
  useEffect(() => {
    if (follow && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines, follow]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Logs de ${container.name}`}>
        <div className="modal-head">
          <div>
            <h3>{container.name}</h3>
            <span className="muted small mono">{container.image}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-tools">
          <label className="search">
            <Icon name="search" size={14} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar líneas…" autoFocus />
          </label>
          <label className="toggle">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            <span />
            Seguir en directo
          </label>
        </div>
        <div className="logs" ref={bodyRef}>
          {error && <div className="log-line error">{error}</div>}
          {!error && lines.length === 0 && <div className="muted">{filter ? "Ninguna línea coincide." : "Sin logs todavía."}</div>}
          {lines.map((l) => (
            <div key={l.i} className={`log-line ${l.level}`}>
              {l.time && <span className="log-time">{l.time}</span>}
              <span>{l.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
