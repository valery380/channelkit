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

- **WhatsApp** (Baileys, optional) — QR code linking, magic codes + auto-created groups for multi-service
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
npx channelkit
```

That's it — no install needed. ChannelKit will download and run.

### Install options

| Method | Command | When to use |
|--------|---------|-------------|
| **npx** (no install) | `npx channelkit` | Try it out, quick start |
| **Global install** | `npm install -g channelkit` | Daily use, shorter commands |

With npx, prefix all commands with `npx` (e.g. `npx channelkit demo`).
With a global install, just use `channelkit` directly.

> **Permission error on global install?** Use [nvm](https://github.com/nvm-sh/nvm) to manage Node — it installs to your home directory, no sudo needed.
> Already have Node without nvm? See [npm docs on fixing permissions](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally).

On first run, ChannelKit will ask how you'd like to set up:

- **Dashboard** — creates a minimal config, starts the server, and opens the dashboard in your browser. You'll get an API secret to log in and configure everything from the UI.
- **CLI wizard** — step-by-step terminal setup: pick a channel, enter credentials, set a webhook URL, and start.

All configuration is stored in `~/.channelkit/` (config, auth sessions, logs).

### Running

```bash
channelkit                         # start (opens dashboard automatically)
channelkit start --tunnel          # start with a public URL (Cloudflare tunnel)
channelkit demo                    # run the built-in echo server for testing
channelkit daemon install          # install as a system service (starts on boot)
```

> Using npx? Just prefix: `npx channelkit demo`, `npx channelkit daemon install`, etc.

### Public URL (Cloudflare Tunnel)

ChannelKit can expose your local instance to the internet using a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). This is required for features like inbound webhooks (Resend, Twilio) and voice calls, which need a publicly reachable URL.

#### Quick tunnel (no setup needed)

Just run:

```bash
channelkit start --tunnel
```

This creates a temporary public URL via [trycloudflare.com](https://trycloudflare.com) — no Cloudflare account or installation required. The URL changes each time you restart.

> **Note:** You can also start and stop the tunnel from the dashboard at any time.

#### Fixed URL (requires setup)

If you need a stable URL that doesn't change between restarts, follow the steps below to set up a named Cloudflare Tunnel.

##### 1. Install cloudflared

```bash
# macOS
brew install cloudflared

# Linux (Debian/Ubuntu)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Windows
winget install Cloudflare.cloudflared
```

##### 2. Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens your browser to authorize `cloudflared` with your Cloudflare account. You need a domain managed by Cloudflare.

##### 3. Create a tunnel

```bash
cloudflared tunnel create channelkit
```

This generates a tunnel ID and a credentials file. Note the tunnel ID — you'll need it next.

##### 4. Route DNS to the tunnel

```bash
cloudflared tunnel route dns channelkit ck.yourdomain.com
```

Replace `ck.yourdomain.com` with the subdomain you want to use. This creates a CNAME record pointing to the tunnel.

##### 5. Configure ChannelKit

Add the tunnel section to your `config.yaml`:

```yaml
tunnel:
  provider: cloudflared
  token: <your-tunnel-token>       # from the credentials file or Cloudflare dashboard
  public_url: https://ck.yourdomain.com
  auto_start: true                 # start the tunnel automatically with ChannelKit
  expose_dashboard: true           # expose the dashboard through the tunnel
```

To get the tunnel token, you can either:
- Copy it from the Cloudflare Zero Trust dashboard under **Networks → Tunnels → your tunnel → Configure**
- Or use the credentials JSON file generated by `cloudflared tunnel create`

##### 6. Start ChannelKit with the tunnel

```bash
channelkit start --tunnel
```

ChannelKit will start `cloudflared` automatically and route traffic through your public URL. You can verify it's working by visiting `https://ck.yourdomain.com` in your browser.

> **Tip:** If you set `auto_start: true` in the tunnel config, you don't need the `--tunnel` flag — the tunnel starts automatically with `channelkit start`.

## CLI Commands

```bash
channelkit                         # start (auto-runs init on first run)
channelkit init                    # interactive setup wizard
channelkit start [-c path]         # start the gateway

channelkit channel add             # add a new channel interactively
channelkit channel list            # list configured channels
channelkit channel remove <name>   # remove a channel

channelkit service add             # add a new service interactively
channelkit service list            # list configured services
channelkit service remove <name>   # remove a service

channelkit install-skill           # install Claude Code skill
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
      provider: google # google | whisper | deepgram
      language: he-IL # primary language
      alternative_languages: # auto-detect from these + primary
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
      provider: elevenlabs # google | elevenlabs | openai
      voice: 21m00Tcm4TlvDq8ikWAM # optional voice ID
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
      provider: openai # openai | anthropic | google
      model: gpt-4o-mini # optional, each provider has a sensible default
      prompt: "Extract the expense amount and category as JSON"
```

**Supported providers and defaults:**

| Provider  | Default Model              | API Key             |
| --------- | -------------------------- | ------------------- |
| OpenAI    | `gpt-4o-mini`              | `OPENAI_API_KEY`    |
| Anthropic | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` |
| Google    | `gemini-2.5-flash`         | `GOOGLE_API_KEY`    |

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
{ "name": "Sarah", "amount": 45, "category": "lunch" }
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

## Gmail Channel Setup

Setting up a Gmail channel requires creating OAuth2 credentials in Google Cloud Console. Here's a step-by-step guide:

### 1. Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top and select **New Project**
3. Enter a name (e.g. "ChannelKit") and click **Create**

### 2. Enable the Gmail API

1. In your project, go to **APIs & Services → Library**
2. Search for **Gmail API**
3. Click **Gmail API** and then **Enable**

### 3. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**
2. Select **External** user type (or **Internal** if using Google Workspace) and click **Create**
3. Fill in the required fields:
   - **App name**: e.g. "ChannelKit"
   - **User support email**: your email
   - **Developer contact email**: your email
4. Click **Save and Continue**
5. On the **Scopes** page, click **Add or Remove Scopes**
6. Search for `https://www.googleapis.com/auth/gmail.modify` and check it
7. Click **Update** → **Save and Continue**
8. On the **Test users** page, click **Add Users** and add the Gmail address you want to connect
9. Click **Save and Continue** → **Back to Dashboard**

> **Note:** While your app is in "Testing" status, only the test users you added can authorize. This is fine for personal use. To remove the test user limitation, you'd need to publish the app and go through Google's verification process.

### 4. Create OAuth2 credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Select **Desktop app** as the application type
4. Enter a name (e.g. "ChannelKit Desktop")
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

### 5. Configure the channel

Add the Gmail channel via CLI:

```bash
channelkit channel add
# → Choose Email → Gmail
# → Paste your Client ID and Client Secret
# → Set poll interval (default 30 seconds)
```

Or add it directly to `config.yaml`:

```yaml
channels:
  gmail:
    type: email
    provider: gmail
    client_id: "123456789-abc.apps.googleusercontent.com"
    client_secret: "GOCSPX-..."
    poll_interval: 30
```

### 6. Authorize

When you start ChannelKit, it will automatically open your browser for OAuth authorization. Sign in with the Gmail account you added as a test user, grant access, and the token is saved locally in `~/.channelkit/auth/gmail-<channel-name>.json`.

```bash
channelkit start
# → Browser opens → sign in → authorize → done
```

The refresh token is saved automatically. You won't need to re-authorize unless you revoke access or delete the token file.

## Config

Default location: `~/.channelkit/config.yaml`

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
    code: "EXPENSES" # magic code for WhatsApp multi-service
    stt:
      provider: google
      language: he-IL
    tts:
      provider: elevenlabs
  assistant:
    channel: telegram
    webhook: "http://localhost:3000/assistant"
    command: "assistant" # slash command for Telegram multi-service
```

## Async Messaging API

Every webhook payload includes a `replyUrl` — a callback endpoint your service can use to send messages at any time.

### Webhook payload

```json
{
  "id": "msg_abc123",
  "channel": "whatsapp",
  "from": "+44123456789",
  "text": "What's my balance?",
  "replyUrl": "http://localhost:4000/api/send/whatsapp/44123456789%40s.whatsapp.net"
}
```

### Sync response (immediate)

```json
{ "text": "Your balance is $42.00" }
```

### Async message (anytime)

```bash
curl -X POST "http://localhost:4000/api/send/whatsapp/44123456789%40s.whatsapp.net" \
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

All logs are stored in SQLite (`~/.channelkit/data/logs.db`) with automatic 30-day retention.

## MCP Server

ChannelKit includes a [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI assistants (Claude, etc.) manage your messaging gateway programmatically.

### Configuration

```yaml
mcp:
  enabled: true
  stdio: true # enable stdio transport (for Claude Desktop)
  secret: "my-token" # optional Bearer token for auth
```

### Available tools

| Tool             | Description                                               |
| ---------------- | --------------------------------------------------------- |
| `send_message`   | Send a message through any channel                        |
| `get_messages`   | Retrieve message history with search/filtering            |
| `list_channels`  | View all channels and their status                        |
| `add_channel`    | Add a new channel (WhatsApp, Telegram, Email, SMS, Voice) |
| `remove_channel` | Remove a channel                                          |
| `list_services`  | View all services                                         |
| `add_service`    | Create a service with STT/TTS/format config               |
| `update_service` | Modify service settings                                   |
| `remove_service` | Remove a service                                          |
| `get_status`     | Get uptime, stats, version info, update availability      |
| `update`         | Update ChannelKit to the latest version                   |
| `set_config`     | Set config values (e.g., `settings.openai_api_key`)       |

### Transports

- **Streamable HTTP** — `http://localhost:4000/mcp` (modern clients)
- **SSE** — `http://localhost:4000/sse` + `/messages` (legacy clients)
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

Or connect to a running instance via HTTP at `http://localhost:4000/mcp`.

## Claude Code Skill

ChannelKit ships with a skill file that teaches Claude Code how to set up channels, create services, and integrate messaging into your app using the MCP tools.

```bash
channelkit install-skill          # copies skill to ~/.claude/skills/channelkit/SKILL.md
```

The installer will also print a short snippet to add to your `~/.claude/CLAUDE.md`. This ensures Claude Code always knows about ChannelKit's built-in features (TTS/STT, MCP tools, etc.) without relying on the skill trigger to fire. Add it to your `~/.claude/CLAUDE.md` (create the file if it doesn't exist):

```markdown
## ChannelKit

When working with WhatsApp, SMS, Voice, Telegram, or Email messaging:
- **ChannelKit has built-in TTS/STT.** Never install TTS or STT packages in the app. Configure TTS on the ChannelKit service — the app just returns `{ "text": "..." }` and ChannelKit converts it to audio automatically.
- **Use ChannelKit MCP tools** (get_status, send_message, add_channel, etc.) — not curl. If MCP tools are not available, ask the user to connect: `claude mcp add --transport http channelkit http://localhost:4000/mcp`
- **Do not install ChannelKit** unless the user explicitly asks — it's likely already running.
- Run `/channelkit` to load the full ChannelKit skill with detailed integration docs, MCP tool reference, and setup patterns.
```

If ChannelKit runs on a different machine (e.g., a server) than Claude Code (your dev laptop), use `--print` to output the skill and transfer it:

```bash
# On the server
channelkit install-skill --print > channelkit-skill.md

# Copy to your dev machine
scp server:channelkit-skill.md ~/.claude/skills/channelkit/SKILL.md
```

## Webhook API

### Your app receives

```json
{
  "id": "msg_abc123",
  "channel": "whatsapp",
  "from": "+44123456789",
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

| Channel            | Status     | Multi-Service        |
| ------------------ | ---------- | -------------------- |
| WhatsApp (Baileys) | ✅ Working | Magic codes + groups |
| Telegram (grammY)  | ✅ Working | Slash commands       |
| Email — Gmail      | ✅ Working | —                    |
| Email — Resend     | ✅ Working | —                    |
| SMS (Twilio)       | ✅ Working | —                    |
| Voice (Twilio)     | ✅ Working | —                    |

## Auto-Start on Reboot

ChannelKit can install itself as a system service that starts automatically on boot.

### Quick setup

```bash
channelkit daemon install
```

That's it! ChannelKit will start on boot and restart if it crashes.

> **Tip:** ChannelKit also asks about this on first run — just answer "y" when prompted.

### Manage the service

```bash
channelkit daemon status      # check if running
channelkit daemon stop        # stop the service
channelkit daemon start       # start the service
channelkit daemon uninstall   # remove the service
```

### How it works

- **macOS** — creates a LaunchAgent at `~/Library/LaunchAgents/com.channelkit.server.plist` with KeepAlive + RunAtLoad
- **Linux** — creates a systemd user service at `~/.config/systemd/user/channelkit.service` with Restart=on-failure

Logs:
- **macOS:** `~/.channelkit/channelkit.log`
- **Linux:** `journalctl --user -u channelkit -f`

<details>
<summary>Manual setup (if you prefer)</summary>

#### macOS (launchd)

Find paths:
```bash
which channelkit
which node
```

Create `~/Library/LaunchAgents/com.channelkit.server.plist` with ProgramArguments pointing to node + channelkit, RunAtLoad + KeepAlive enabled, and PATH set to include your node binary directory.

#### Linux (systemd)

Create `~/.config/systemd/user/channelkit.service`:
```ini
[Unit]
Description=ChannelKit Messaging Gateway
After=network.target

[Service]
Type=simple
ExecStart=/path/to/node /path/to/channelkit start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable channelkit
systemctl --user start channelkit
loginctl enable-linger
```

</details>

## WhatsApp Setup

WhatsApp support requires the `@whiskeysockets/baileys` package, which is an **optional peer dependency** — it is not installed automatically with ChannelKit.

> **License notice:** `@whiskeysockets/baileys` depends on `libsignal-node`, which is licensed under **GPL-3.0**. By installing it, you accept the GPL-3.0 terms for that dependency. The ChannelKit core remains MIT-licensed.

### Install Baileys

If ChannelKit is installed globally:

```bash
npm install -g @whiskeysockets/baileys
```

If running from a project directory:

```bash
npm install @whiskeysockets/baileys
```

Without this package, ChannelKit will skip any WhatsApp channels in your config and print a warning. All other channels (Telegram, Email, SMS, Voice, Endpoint) work without it.

### Pair your device

Start ChannelKit and scan the QR code with WhatsApp:

```bash
channelkit start
```

Open WhatsApp on your phone > Settings > Linked Devices > Link a Device, then scan the QR code shown in the terminal.

### Provision a new number

To buy a Twilio number and automatically pair it with WhatsApp:

```bash
channelkit channel provision
```

## Development

```bash
git clone https://github.com/valery380/channelkit.git
cd channelkit
npm install
npm run dev    # starts with auto-reload on code changes
```

## Security

ChannelKit is designed to run on a dedicated server. Follow these guidelines to secure your deployment:

### Required for production

- **Set `api_secret`** in your config — this protects all dashboard and API endpoints with Bearer token authentication. It is auto-generated on first run. Without it, anyone with network access can control your instance.
- **Run behind a reverse proxy** (nginx, Caddy, Traefik) with TLS termination. ChannelKit itself serves HTTP; the proxy handles HTTPS.
- **Use firewall rules** to restrict port 4000 to localhost if using a reverse proxy, or to trusted IPs only.

### Credentials

- **Never commit your config** to version control. Config is stored in `~/.channelkit/` by default, outside your project directory.
- **Set a strong MCP secret** in Settings if you expose the MCP server externally.
- **Webhook signature verification** is enabled automatically for Twilio and Resend channels when `auth_token` / `webhook_secret` are configured.

### What's protected

| Feature                       | Protection                                |
| ----------------------------- | ----------------------------------------- |
| Dashboard & admin APIs        | `api_secret` Bearer token                 |
| WebSocket (real-time updates) | Token validated on connection             |
| `/api/send` endpoint          | `api_secret` Bearer token                 |
| MCP server                    | `mcp.secret` Bearer token (external only) |
| Inbound webhooks (Twilio)     | Request signature verification            |
| Inbound webhooks (Resend)     | Svix signature verification               |
| Endpoint channels             | Optional `X-Channel-Secret` header        |

### Additional hardening

- Rate limiting is applied to all endpoints (60/min for send, 120/min for inbound, 300/min for dashboard)
- Security headers (CSP, X-Frame-Options, etc.) are set via `helmet`
- Webhook URLs are validated against private IP ranges (SSRF protection) — see [Local webhooks](#local-webhooks) to allow localhost/private IPs
- Channel/service names are restricted to alphanumeric characters, hyphens, and underscores
- Sensitive fields (API keys, tokens) are masked in API responses
- Server log broadcasts redact common API key patterns

### Local webhooks

By default, ChannelKit blocks webhook requests to `localhost`, `127.0.0.1`, and private IP ranges (`10.x`, `172.16-31.x`, `192.168.x`) as SSRF protection. Cloud metadata endpoints (`169.254.169.254`) are **always** blocked regardless of this setting.

If your webhook server runs locally or on a private network, add this to your `config.yaml`:

```yaml
settings:
  allow_local_webhooks: true
```

This is common during development or when ChannelKit and your app run on the same machine or local network.

## License

MIT — see [LICENSE](LICENSE).

WhatsApp integration requires `@whiskeysockets/baileys` (optional peer dependency, GPL-3.0 via `libsignal-node`). Installing it is opt-in and subject to its own license terms.
