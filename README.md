# DiyaGPT

A private ChatGPT/Claude-style assistant at **https://divyambanga.github.io/diyagpt/**, backed by an Azure AI Foundry deployment.

- **Chat:** streaming answers, thinking modes (Instant / Thinking / Deep), visible reasoning, web search with sources, Python code & charts, edit and regenerate with branches, markdown, code highlighting and math.
- **Files:** photos, PDFs, Word/Excel/PowerPoint, iWork, code, CSV and text are read directly. Anything else (zip, audio…) is available to the Python tool.
- **History:** chats are saved server-side and sync across devices, with search across titles and message text.
- **Admin:** open `#/admin` for usage charts, the activity log, kill switches, limits, sessions, lockouts, passwords and phone alerts.

## How it's built

```
web/      React + Vite frontend, deployed to GitHub Pages by .github/workflows/pages.yml
worker/   Cloudflare Worker API + D1 database (deployed with wrangler)
```

The browser never sees the Azure key. The Worker holds it as a secret, checks passwords server-side, enforces lockouts, stores chats, logs activity and proxies requests to Azure.

### Security

- Passwords are stored as salted HMAC-SHA256 hashes, keyed with a server-side pepper. Sessions are random 256-bit tokens, and only their SHA-256 hash is stored, so a session can be revoked.
- 5 wrong passwords from one network locks it out for 15 minutes, and 10 in a day locks it out for 24 hours. 30 wrong passwords in an hour from anywhere locks sign-in for everyone for an hour. A locked network gets no answer either way.
- The admin panel has its own password, its own lockout counters and 12-hour sessions.
- CORS only allows this site, and the page refuses to load in frames. It ships a strict Content-Security-Policy.

### Deploying changes

- **Frontend:** push to `main` and GitHub Actions builds and publishes it.
- **Worker:** run `cd worker && npx wrangler deploy`.
- **Secrets** (one-time; never commit them): `npx wrangler secret put AZURE_BASE`, `AZURE_KEY` and `PEPPER`.
- **Schema:** run `npx wrangler d1 execute diyagpt --remote --file=schema.sql`.

To rotate the Azure key, run `npx wrangler secret put AZURE_KEY`. Passwords are changed from the admin panel.
