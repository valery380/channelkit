export const API = window.location.origin;
export const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

/** Get the stored API secret token. */
export function getToken() {
  return localStorage.getItem('ck_token') || '';
}

/** Store the API secret token. */
export function setToken(token) {
  localStorage.setItem('ck_token', token);
}

/** Clear the stored token. */
export function clearToken() {
  localStorage.removeItem('ck_token');
}

/** Build headers object with Authorization if a token is stored. */
export function authHeaders(extra = {}) {
  const token = getToken();
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Wrapper around fetch that injects auth headers. */
export function apiFetch(url, opts = {}) {
  const headers = authHeaders(opts.headers || {});
  return fetch(url, { ...opts, headers });
}
