# Streamliner Desktop

Phase 4a is a thin Tauri v2 Windows shell for the local Streamliner API. The app lives in the tray, opens a notification feed window, backfills notifications from `GET /api/notifications`, and listens to `/api/notifications/events` over SSE.

Toasts are deliberately excluded until Phase 4b. The SSE client has a no-op toast hook and keeps `Last-Event-ID` in memory only, so cold launches connect without replay cursor persistence.

## Assumption

Start the Streamliner API first. The default API base is `http://127.0.0.1:4319`; override with `STREAMLINER_API_BASE_URL`. The dashboard base is fetched from `GET /api/client-config`, or can be overridden with `STREAMLINER_DASHBOARD_BASE_URL`.

## Commands

```powershell
npm install
npm run build
npm test
cd src-tauri
cargo build
```

Use `npm run tauri dev` only for manual GUI/tray verification in an interactive desktop session.
