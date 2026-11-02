export const API = import.meta.env.VITE_API;

const KEYS = { user: 'diyagpt.token', admin: 'diyagpt.admin' };

export const tokens = {
  get(role = 'user') {
    try {
      return localStorage.getItem(KEYS[role]);
    } catch {
      return null;
    }
  },
  set(role, value) {
    try {
      if (value) localStorage.setItem(KEYS[role], value);
      else localStorage.removeItem(KEYS[role]);
    } catch {}
  },
};

export class ApiError extends Error {
  constructor(status, body = {}) {
    super(body.message || `Request failed (${status})`);
    this.status = status;
    this.code = body.error;
    this.body = body;
  }
}

const signedOut = { user: null, admin: null };
export function onSignedOut(role, fn) {
  signedOut[role] = fn;
}

export async function request(path, { method = 'GET', body, role = 'user', signal, raw = false } = {}) {
  const headers = {};
  const token = tokens.get(role);
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, { error: 'network', message: 'Can’t reach DiyaGPT. Check your connection and try again.' });
  }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.error === 'auth' && token) {
      tokens.set(role, null);
      signedOut[role]?.();
    }
    throw new ApiError(res.status, data);
  }
  return data;
}

export const api = {
  get: (path, opts) => request(path, opts),
  post: (path, body = {}, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body = {}, opts) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body = {}, opts) => request(path, { ...opts, method: 'PATCH', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};

// XHR instead of fetch so we get upload progress.
export function uploadFile(blob, name, chatId, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('purpose', 'assistants');
    form.append('file', blob, name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/api/files?chat_id=${encodeURIComponent(chatId)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${tokens.get('user')}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        if (xhr.status === 401) {
          tokens.set('user', null);
          signedOut.user?.();
        }
        reject(new ApiError(xhr.status, data));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, { message: 'Upload failed. Check your connection.' }));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(form);
  });
}

// Fetches a stored file as an object URL. Results are cached for the session.
const fileUrls = new Map();
export function fileUrl(id, mime) {
  if (!fileUrls.has(id)) {
    const p = fetch(`${API}/api/files/${id}`, { headers: { Authorization: `Bearer ${tokens.get('user')}` } })
      .then((r) => {
        if (!r.ok) throw new ApiError(r.status, { message: 'Couldn’t load that file.' });
        return r.blob();
      })
      .then((b) => URL.createObjectURL(mime ? new Blob([b], { type: mime }) : b));
    p.catch(() => fileUrls.delete(id));
    fileUrls.set(id, p);
  }
  return fileUrls.get(id);
}

export async function downloadFile(id, name, mime) {
  const url = await fileUrl(id, mime);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function* readSSE(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    if (buf.includes('\r')) buf = buf.replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      try {
        yield JSON.parse(data);
      } catch {}
    }
  }
}
