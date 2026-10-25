import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";

const HISTORY = 90;
const GITHUB_REFRESH = 5 * 60_000;

// Resumen de GitHub de un usuario, refrescado cada 5 minutos
export function useGitHub(username) {
  const [state, setState] = useState({ data: null, error: null, loading: false });
  const reqId = useRef(0);

  const load = useCallback(async () => {
    if (!username) return;
    const id = ++reqId.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(`/github/${encodeURIComponent(username)}`);
      if (id === reqId.current) setState({ data, error: null, loading: false });
    } catch (error) {
      // Ignora respuestas de búsquedas anteriores que lleguen tarde
      if (id === reqId.current) setState((s) => ({ data: s.data?.profile.login.toLowerCase() === username.toLowerCase() ? s.data : null, error, loading: false }));
    }
  }, [username]);

  useEffect(() => {
    load();
    const timer = setInterval(load, GITHUB_REFRESH);
    return () => clearInterval(timer);
  }, [load]);

  return { ...state, reload: load };
}

// Estado de los contenedores en directo vía Server-Sent Events
export function useDockerStream() {
  const [containers, setContainers] = useState(null);
  const [history, setHistory] = useState({});
  const [error, setError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    const source = new EventSource("/api/docker/stream");

    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false)); // EventSource reintenta solo

    source.addEventListener("snapshot", (e) => {
      const snap = JSON.parse(e.data);
      if (snap.containers.length) setContainers(snap.containers);
      setHistory(snap.history);
      setError(snap.error);
    });

    source.addEventListener("tick", (e) => {
      const { t, containers } = JSON.parse(e.data);
      setContainers(containers);
      setUpdatedAt(t);
      setError(null);
      setHistory((prev) => {
        const next = {};
        for (const c of containers) {
          const h = prev[c.id] ?? [];
          next[c.id] = c.stats ? [...h, { t, cpu: c.stats.cpu, mem: c.stats.memUsed }].slice(-HISTORY) : h;
        }
        return next;
      });
    });

    source.addEventListener("failure", (e) => setError(JSON.parse(e.data).message));

    return () => source.close();
  }, []);

  // Tras una acción se aplica el nuevo estado sin esperar al siguiente tick
  const patch = useCallback((container) => {
    if (container) setContainers((list) => list?.map((c) => (c.id === container.id ? container : c)));
  }, []);

  return { containers, history, error, connected, updatedAt, patch };
}

export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      if (value) localStorage.setItem(key, value);
    } catch {}
  }, [key, value]);
  return [value, setValue];
}
