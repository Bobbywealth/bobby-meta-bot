# bobby-meta-bot

Meta (Messenger + Instagram) AI autoresponder plus Privacy / Terms / Data Deletion endpoints.

## Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Service status |
| `/health` | GET | Health check (used by Render) |
| `/privacy` | GET | Privacy Policy HTML |
| `/terms` | GET | Terms of Service HTML |
| `/deletion` | GET | Data Deletion info page |
| `/deletion` | POST | Handles Meta `signed_request`, returns confirmation URL |
| `/deletion-status/:code` | GET | Status page shown after deletion |
| `/webhook/meta` | GET | Meta webhook verification (returns `hub.challenge`) |
| `/webhook/meta` | POST | Meta event receiver |

## Local development

```bash
cp .env.example .env   # set APP_SECRET, META_VERIFY_TOKEN, META_APP_ID
npm install
npm run dev
```

## Deployment

Deploy as a Render Web Service:
- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Plan: `free` works for testing

Set env vars on Render dashboard (do NOT commit `.env`):
- `APP_SECRET` — Meta App Settings → Basic → App Secret
- `META_APP_ID` — Meta App ID (e.g. `1451073037030383`)
- `META_VERIFY_TOKEN` — any random string of your choosing; you set this in the Meta webhook UI too

## Meta app fields to fill in with these URLs

| Meta field | URL |
|---|---|
| Privacy Policy URL | `https://<service>.onrender.com/privacy` |
| Terms of Service URL | `https://<service>.onrender.com/terms` |
| User data deletion | `https://<service>.onrender.com/deletion` |
| Webhook Callback URL | `https://<service>.onrender.com/webhook/meta` |
| Webhook Verify Token | (same as `META_VERIFY_TOKEN` env var) |

## Verifying locally

```bash
curl -s http://localhost:10000/health | jq
curl -s http://localhost:10000/privacy | head -5
```

## Notes

- The autoresponder logic (AI reply generation) is intentionally a stub for now. Wire it up in a follow-up commit once the platform handshake is verified end-to-end.
- `signed_request` verification uses HMAC-SHA256 with the App Secret. Never log the raw signed_request — log the user_id and confirmation_code only.
