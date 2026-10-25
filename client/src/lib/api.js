export class ApiError extends Error {
  constructor(message, status, body = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api(path, { method = "GET" } = {}) {
  const headers = method === "GET" ? {} : { "X-DevDash": "1" };
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers });
  } catch {
    throw new ApiError("No se puede conectar con el servidor de DevDash", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `Error ${res.status}`, res.status, body);
  return body;
}
