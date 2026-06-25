# Provisioning API

A scoped HTTP endpoint for creating ChannelKit **services** from an external system
(e.g. a backend that needs to register a new channel→webhook mapping on the fly),
**without** handing out the full-admin `api_secret`.

- **Create-only.** It can create services. It cannot read, update, or delete services,
  touch channels, or reach the dashboard.
- **Separate secret.** Guarded by its own `provision_secret`, independent from `api_secret`.
- **Externally reachable.** Allowlisted through the tunnel's external-access guard, so it
  works even with `tunnel.expose_dashboard: false` — the rest of the admin API/dashboard
  stays blocked from the internet.
- **Off by default.** Returns `403` unless `provision_secret` is set in config.

## Endpoint

```
POST /api/provision/services
Authorization: Bearer <provision_secret>
Content-Type: application/json
```

### Body

| field         | required | notes                                                                    |
|---------------|----------|--------------------------------------------------------------------------|
| `name`        | ✅       | service id; must match `^[a-zA-Z0-9_-]+$`; unique                         |
| `channel`     | ✅       | must be an existing channel name in ChannelKit                           |
| `webhook`     | ✅       | URL ChannelKit forwards inbound messages to                              |
| `auth`        | optional | header ChannelKit sends to your webhook (see below)                      |
| `code`        | optional | onboarding keyword users send to connect (e.g. `ors`)                    |
| `command`     | optional | slash command (Telegram), e.g. `/ors`                                    |
| `method`      | optional | `POST` (default), `GET`, `PUT`, or `PATCH`                               |
| `allow_list`  | optional | array of allowed sender ids                                              |
| `description` | optional | used by AI routing                                                       |

`auth` is either `{"type":"header","header_name":"...","header_value":"..."}` or
`{"type":"bearer","token":"..."}`. This is the credential ChannelKit attaches **when
calling your webhook**.

### Example

```bash
curl -X POST https://<tunnel-host>/api/provision/services \
  -H "Authorization: Bearer $PROVISION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "oren_roy_shay",
    "channel": "split_ahoy_on_telegram",
    "webhook": "https://settleshare.web.app/api/groups/<id>/parse",
    "code": "ors",
    "command": "/ors",
    "auth": { "type": "header", "header_name": "x-api-secret", "header_value": "sa_..." }
  }'
```

### Responses

| status | meaning                                                        |
|--------|----------------------------------------------------------------|
| `200`  | `{"ok":true}` — created                                        |
| `400`  | missing required field, unknown `channel`, or invalid `name`/`method`/`auth.type` |
| `401`  | missing/invalid `provision_secret` Bearer token                |
| `403`  | provisioning disabled (`provision_secret` not set in config)   |
| `409`  | a service with that `name` already exists                      |

Creation is **not** an upsert. Treat `409` as "already exists" (success), or use the
admin `PUT/DELETE /api/config/services/:name` to change/remove an existing one.
A successful create hot-reloads the router — **no restart needed**.

## Setup (ChannelKit host)

Add to `~/.channelkit/config.yaml`:

```yaml
provision_secret: "prov_<strong-random-string>"

tunnel:
  provider: cloudflared
  expose_dashboard: false      # keep admin API private; only provision + inbound are exposed
  # token: "<cloudflare-tunnel-token>"   # for a STABLE public URL (recommended for production)
```

- Without a `token`, cloudflared issues a random `*.trycloudflare.com` URL that changes on
  restart (fine for testing). Use a Cloudflare **named-tunnel token** for a stable URL.
- Restart ChannelKit; it auto-starts the tunnel and logs the public URL.

## Caller notes (e.g. Firebase Functions)

- Store `provision_secret` as a server-side secret — never in client/browser code.
- Read the webhook contract for the service side (how to reply to messages) — your webhook
  replies either synchronously by returning `{"text":"..."}`, or asynchronously by POSTing
  `{"text":"..."}` to the `replyUrl` included in each inbound payload.

## Webhook contract (what your `webhook` receives)

```
POST <your webhook>
Content-Type: application/json
<your service auth header, e.g. x-api-secret: sa_...>
```

Body is the message plus a `replyUrl`:

```json
{
  "id": "11",
  "channel": "telegram",
  "channelName": "split_ahoy_on_telegram",
  "from": "5665030843",
  "senderName": "Sha Sha",
  "type": "text",
  "text": "the user's message",
  "timestamp": 1782395302,
  "groupId": null,
  "groupName": null,
  "replyUrl": "https://<tunnel-host>/api/send/telegram/5665030843"
}
```

To reply, **either** return `200` with `{"text":"..."}` (synchronous), **or** return `200`
and later `POST {"text":"..."}` to `replyUrl` (asynchronous; no auth header required).
Returning `200` with an empty body sends nothing back to the chat.
