import { useCallback, useEffect, useState } from "react";
import Icon from "./components/Icon.jsx";
import GitHubSection from "./components/GitHubSection.jsx";
import DockerSection from "./components/DockerSection.jsx";
import { api } from "./lib/api.js";
import { useDockerStream, useGitHub, useLocalStorage } from "./lib/hooks.js";

const USERNAME_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

function UserSearch({ username, onChange }) {
  const [value, setValue] = useState(username ?? "");
  useEffect(() => setValue(username ?? ""), [username]);
  const valid = USERNAME_RE.test(value.trim());

  return (
    <form
      className="user-search"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onChange(value.trim());
      }}
    >
      <Icon name="github" size={15} />
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="usuario de GitHub" aria-label="Usuario de GitHub" spellCheck="false" />
      <button className="btn btn-sm" disabled={!valid || value.trim() === username}>
        Ver
      </button>
    </form>
  );
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [username, setUsername] = useLocalStorage("devdash:user", null);
  const [toasts, setToasts] = useState([]);
  const github = useGitHub(username);
  const docker = useDockerStream();

  useEffect(() => {
    api("/status")
      .then((s) => {
        setStatus(s);
        setUsername((u) => u ?? s.github.defaultUser);
      })
      .catch(() => {});
  }, [setUsername]);

  const notify = useCallback((text, kind = "ok") => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <a className="logo" href="/">
            <img src="/favicon.svg" alt="" width="28" height="28" />
            <span className="logo-text">
              Dev<span>Dash</span>
            </span>
          </a>
          <UserSearch username={username} onChange={setUsername} />
        </div>
      </header>

      <main className="main">
        <GitHubSection {...github} reload={github.reload} />
        <DockerSection stream={docker} status={status} notify={notify} />
      </main>

      <footer className="footer muted small">
        DevDash · métricas de GitHub y estado de Docker en una sola vista
      </footer>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
