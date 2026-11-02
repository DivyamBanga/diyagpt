import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The CSP is only injected into production builds (Vite's dev server relies on inline scripts).
function csp(api) {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${api}`,
    "media-src 'self' blob:",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  return {
    base: '/diyagpt/',
    plugins: [react(), csp(env.VITE_API)],
    build: { target: 'es2020', chunkSizeWarningLimit: 2000 },
  };
});
