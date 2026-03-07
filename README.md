# ChannelKit

A self-hosted messaging gateway that connects chat channels (WhatsApp, Telegram, Email) to any application via webhooks.

Think **nginx, but for chat.**

```
📱 WhatsApp ──┐
💬 Telegram ──┤──→ ChannelKit ──→ Your App (webhook)
📧 Email    ──┘     (unified JSON)
```

Your app receives every message in a **unified JSON format**, regardless of source channel. Respond with text or media, and ChannelKit routes it back through the originating channel.

## Features

- **WhatsApp** (Baileys) — QR code linking, magic codes + auto-created groups for multi-service
- **Telegram** (grammY) — bot token setup, slash commands for multi-service
- **Email** — Gmail (OAuth2 + polling) and Resend (API + polling/webhook)
- **Services model** — single or multiple services per channel, each with its own webhook
- **SMS** (Twilio) — inbound/outbound SMS via polling or webhooks
- **Voice** (Twilio) — inbound voice calls with STT, webhook, and TTS/Say responses
- **Speech-to-Text** — automatic transcription of voice messages (Google, Whisper, Deepgram)
- **Text-to-Speech** — voice responses when your webhook returns `voice: true` (Google, ElevenLabs, OpenAI)
- **Auto language detection** — STT supports multiple languages with automatic detection
- **AI formatting** — transform incoming messages with AI (OpenAI, Anthropic, Google) before forwarding to your webhook
- **MCP server** — Model Context Protocol server lets AI assistants manage channels, services, and send messages
- **Web dashboard** — SQLite-backed logs with real-time WebSocket updates
- **Async messaging API** — `replyUrl` in every webhook payload for sending messages anytime
- **Onboarding flow** — magic codes (WhatsApp) and slash commands (Telegram) for user self-service
- **Echo server** — included test server for quick experimentation

## Quick Start

```bash
npm install -g @dirbalak/channelkit
channelkit init
```

The interactive wizard will guide you through setup — pick a channel, enter credentials, set a webhook URL, and you're done. When setup is complete, the dashboard opens automatically in your browser.

### Running

```bash
channelkit                         # start (opens dashboard automatically)
channelkit start -c my.yaml        # use a custom config file
channelkit start --tunnel           # start with a public URL (Cloudflare tunnel)
```

## CLI Commands

```bash
channelkit init                    # interactive setup wizard
channelkit start [-c config.yaml]  # start the gateway

channelkit channel add             # add a new channel interactively
channelkit channel list            # list configured channels
channelkit channel remove <name>   # remove a channel

channelkit service add             # add a new service interactively
channelkit service list            # list configured services
channelkit service remove <name>   # remove a service
```

## Services & Multi-Service

ChannelKit can route messages from a single channel to multiple backend services.

### Add a service

```bash
channelkit service add
# → Service name: Expenses
# → Webhook: http://localhost:3000/expenses
# → Enable STT? Enable TTS?
# → ✅ Added!
```

### WhatsApp: Magic Codes + Groups

When a channel has multiple services, WhatsApp uses magic codes and auto-created groups:

1. User sends "EXPENSES" to your WhatsApp number (or clicks a `wa.me` link)
2. ChannelKit creates a group "Expenses - \<User Name\>"
3. All messages in that group route to the service's webhook

### Telegram: Slash Commands

For Telegram multi-service, each service gets a slash command:

1. User sends `/expenses` in the bot chat
2. Subsequent messages route to the Expenses service webhook

## Speech-to-Text (STT)

Automatically transcribe voice messages before forwarding to your webhook. Configure per-service:

```yaml
services:
  myapp:
    channel: whatsapp
    webhook: http://localhost:3000
    stt:
      provider: google        # google | whisper | deepgram
      language: he-IL          # primary language
      alternative_languages:   # auto-detect from these + primary
        - en-US
        - ar-IL
```

**API keys via environment variables:**
- Google: `GOOGLE_STT_API_KEY` or `GOOGLE_API_KEY`
- Whisper (OpenAI): `OPENAI_STT_API_KEY` or `OPENAI_API_KEY`
- Deepgram: `DEEPGRAM_STT_API_KEY` or `DEEPGRAM_API_KEY`

## Text-to-Speech (TTS)

When your webhook returns `{ "text": "Hello", "voice": true }`, ChannelKit synthesizes audio and sends a voice message. Configure per-service:

```yaml
services:
  myapp:
    channel: whatsapp
    webhook: http://localhost:3000
    tts:
      provider: elevenlabs     # google | elevenlabs | openai
      voice: 21m00Tcm4TlvDq8ikWAM  # optional voice ID
```

**API keys via environment variables:**
- Google: `GOOGLE_TTS_API_KEY` or `GOOGLE_API_KEY`
- ElevenLabs: `ELEVENLABS_TTS_API_KEY` or `ELEVENLABS_API_KEY`
- OpenAI: `OPENAI_TTS_API_KEY` or `OPENAI_API_KEY`

## AI Formatting

ChannelKit can pass incoming messages through an AI model before forwarding them to your webhook. This enables structured data extraction, translation, classification, and other transformations — all without changing your backend.

The processing pipeline is: **STT** (optional) → **AI Format** → **Webhook**

### Configuration

```yaml
services:
  myapp:
    channel: whatsapp
    webhook: http://localhost:3000
    format:
      provider: openai         # openai | anthropic | google
      model: gpt-4o-mini       # optional, each provider has a sensible default
      prompt: "Extract the expense amount and category as JSON"
```

**Supported providers and defaults:**

| Provider | Default Model | API Key |
|----------|--------------|---------|
| OpenAI | `gpt-4o-mini` | `OPENAI_API_KEY` |
| Anthropic | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` |
| Google | `gemini-2.5-flash` | `GOOGLE_API_KEY` |

API keys can be set as environment variables or in `config.yaml`:

```yaml
settings:
  openai_api_key: "sk-..."
  anthropic_api_key: "sk-ant-..."
  google_api_key: "..."
```

### Example

With this prompt:
```
Extract: name, amount, category. Return JSON only.
```

A message like `"Paid $45 for lunch with Sarah"` becomes:
```json
{"name": "Sarah", "amount": 45, "category": "lunch"}
```

Your webhook receives the formatted text. The original text is preserved in the dashboard logs.

## Voice Channel (Twilio)

ChannelKit supports inbound voice calls via Twilio. The flow:

1. Caller dials your Twilio number → ChannelKit answers with a greeting
2. Caller speaks → recording is captured and transcribed (STT)
3. Transcribed text is sent to your webhook
4. Your webhook responds with text → ChannelKit speaks it back via TTS or `<Say>`
5. In **conversational mode**, the loop repeats; otherwise the call ends

### Setup

```bash
channelkit channel add    # choose Voice (Twilio)
channelkit service add    # configure webhook + voice settings
```

Voice requires a **public URL** — use `--tunnel` or `--public-url` when starting:

```bash
channelkit start --public-url https://your-domain.com
```

### Voice service config

```yaml
services:
  support:
    channel: voice
    webhook: "http://localhost:3000/support"
    stt:
      provider: google
      language: en-US
    tts:
      provider: elevenlabs
    voice:
      greeting: "Hello! Please speak after the beep."
      hold_message: "One moment please..."
      language: en-US
      voice_name: Polly.Joanna
      conversational: true
      max_record_seconds: 30
```

### TTS Audio Serving

When your webhook returns `{ "voice": true }` and TTS is configured, ChannelKit synthesizes audio and plays it to the caller via `<Play>`. Audio clips are cached in memory and served via a one-time URL that expires after 60 seconds.

## Config

```yaml
channels:
  whatsapp:
    type: whatsapp
    number: "+972..."
  telegram:
    type: telegram
    bot_token: "123456:ABC-DEF..."
  gmail:
    type: email
    provider: gmail
    client_id: "..."
    client_secret: "..."
    poll_interval: 30

services:
  expenses:
    channel: whatsapp
    webhook: "http://localhost:3000/expenses"
    code: "EXPENSES"          # magic code for WhatsApp multi-service
    stt:
      provider: google
      language: he-IL
    tts:
      provider: elevenlabs
  assistant:
    channel: telegram
    webhook: "http://localhost:3000/assistant"
    command: "assistant"      # slash command for Telegram multi-service
```

## Async Messaging API

Every webhook payload includes a `replyUrl` — a callback endpoint your service can use to send messages at any time.

### Webhook payload

```json
{
  "id": "msg_abc123",
  "channel": "whatsapp",
  "from": "+972501234567",
  "text": "What's my balance?",
  "replyUrl": "http://localhost:4000/api/send/whatsapp/972501234567%40s.whatsapp.net"
}
```

### Sync response (immediate)
```json
{ "text": "Your balance is $42.00" }
```

### Async message (anytime)
```bash
curl -X POST "http://localhost:4000/api/send/whatsapp/972501234567%40s.whatsapp.net" \
  -H "Content-Type: application/json" \
  -d '{"text": "Your invoice was approved! ✅"}'
```

### Health check
```
GET http://localhost:4000/api/health
→ { "status": "ok", "channels": ["whatsapp"] }
```

## Web Dashboard

ChannelKit includes a built-in web dashboard (enabled by default) that shows:

- Real-time message log with WebSocket updates
- Message details: channel, sender, text, STT transcription, TTS usage
- Search and filter by channel
- Stats: total messages, messages by channel, average latency

All logs are stored in SQLite (`data/logs.db`) with automatic 30-day retention.

## MCP Server

ChannelKit includes a [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI assistants (Claude, etc.) manage your messaging gateway programmatically.

### Configuration

```yaml
mcp:
  enabled: true
  port: 4100              # HTTP transport port
  stdio: true             # enable stdio transport (for Claude Desktop)
  secret: "my-token"      # optional Bearer token for auth
```

### Available tools

| Tool | Description |
|------|-------------|
| `send_message` | Send a message through any channel |
| `get_messages` | Retrieve message history with search/filtering |
| `list_channels` | View all channels and their status |
| `add_channel` | Add a new channel (WhatsApp, Telegram, Email, SMS, Voice) |
| `remove_channel` | Remove a channel |
| `list_services` | View all services |
| `add_service` | Create a service with STT/TTS/format config |
| `update_service` | Modify service settings |
| `remove_service` | Remove a service |
| `get_status` | Get uptime, stats, version info, update availability |
| `update` | Update ChannelKit to the latest version |
| `set_config` | Set config values (e.g., `settings.openai_api_key`) |

### Transports

- **Streamable HTTP** — `http://localhost:4100/mcp` (modern clients)
- **SSE** — `http://localhost:4100/sse` + `/messages` (legacy clients)
- **Stdio** — for Claude Desktop and local integrations

### Connecting from Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "channelkit": {
      "command": "channelkit",
      "args": ["start", "--mcp-stdio"]
    }
  }
}
```

Or connect to a running instance via HTTP at `http://localhost:4100/mcp`.

## Webhook API

### Your app receives

```json
{
  "id": "msg_abc123",
  "channel": "whatsapp",
  "from": "+972501234567",
  "type": "text",
  "text": "What's the temperature?",
  "timestamp": 1708420200,
  "replyUrl": "http://localhost:4000/api/send/whatsapp/..."
}
```

For voice messages with STT enabled, `type` is `"audio"` and `text` contains the transcription.

### Your app responds

```json
{ "text": "Kitchen: 23°C 🌡️" }
```

Or with voice:

```json
{ "text": "Kitchen is 23 degrees", "voice": true }
```

## Echo Server

A test server is included for quick experimentation:

```bash
channelkit demo
```

Runs on port 3000 and echoes back any message it receives.

## Supported Channels

| Channel | Status | Multi-Service |
|---------|--------|---------------|
| WhatsApp (Baileys) | ✅ Working | Magic codes + groups |
| Telegram (grammY) | ✅ Working | Slash commands |
| Email — Gmail | ✅ Working | — |
| Email — Resend | ✅ Working | — |
| SMS (Twilio) | ✅ Working | — |
| Voice (Twilio) | ✅ Working | — |

## Development

```bash
git clone https://github.com/dirbalak/channelkit.git
cd channelkit
npm install
npm run dev    # starts with auto-reload on code changes
```

## Security

ChannelKit is designed to run on a dedicated server. Follow these guidelines to secure your deployment:

### Required for production

- **Set `api_secret`** in `config.yaml` — this protects all dashboard and API endpoints with Bearer token authentication. Without it, anyone with network access can control your instance.
- **Run behind a reverse proxy** (nginx, Caddy, Traefik) with TLS termination. ChannelKit itself serves HTTP; the proxy handles HTTPS.
- **Use firewall rules** to restrict port 4000 to localhost if using a reverse proxy, or to trusted IPs only.

### Credentials

- **Never commit `config.yaml`** to version control (it's in `.gitignore` by default). If you previously committed it, rotate all credentials immediately.
- **Set a strong MCP secret** in Settings if you expose the MCP server externally.
- **Webhook signature verification** is enabled automatically for Twilio and Resend channels when `auth_token` / `webhook_secret` are configured.

### What's protected

| Feature | Protection |
|---------|-----------|
| Dashboard & admin APIs | `api_secret` Bearer token |
| WebSocket (real-time updates) | Token validated on connection |
| `/api/send` endpoint | `api_secret` Bearer token |
| MCP server | `mcp.secret` Bearer token (external only) |
| Inbound webhooks (Twilio) | Request signature verification |
| Inbound webhooks (Resend) | Svix signature verification |
| Endpoint channels | Optional `X-Channel-Secret` header |

### Additional hardening

- Rate limiting is applied to all endpoints (60/min for send, 120/min for inbound, 300/min for dashboard)
- Security headers (CSP, X-Frame-Options, etc.) are set via `helmet`
- Webhook URLs are validated against private IP ranges (SSRF protection)
- Channel/service names are restricted to alphanumeric characters, hyphens, and underscores
- Sensitive fields (API keys, tokens) are masked in API responses
- Server log broadcasts redact common API key patterns

## License

MIT
