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
- **Speech-to-Text** — automatic transcription of voice messages (Google, Whisper, Deepgram)
- **Text-to-Speech** — voice responses when your webhook returns `voice: true` (Google, ElevenLabs, OpenAI)
- **Auto language detection** — STT supports multiple languages with automatic detection
- **Web dashboard** — SQLite-backed logs with real-time WebSocket updates
- **Async messaging API** — `replyUrl` in every webhook payload for sending messages anytime
- **Onboarding flow** — magic codes (WhatsApp) and slash commands (Telegram) for user self-service
- **Echo server** — included test server for quick experimentation

## Quick Start

```bash
git clone https://github.com/dirbalak/channelkit.git
cd channelkit
npm install
npm run init
```

The interactive wizard will guide you through setup — pick a channel, enter credentials, set a webhook URL, and you're done.

### Running after initial setup

```bash
npm start                  # start with existing config
npm run dev                # start with auto-reload (development)
npm start -- -c my.yaml    # use a custom config file
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
npm run service add
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
  "from": "+972542688963",
  "text": "What's my balance?",
  "replyUrl": "http://localhost:4000/api/send/whatsapp/972542688963%40s.whatsapp.net"
}
```

### Sync response (immediate)
```json
{ "text": "Your balance is $42.00" }
```

### Async message (anytime)
```bash
curl -X POST "http://localhost:4000/api/send/whatsapp/972542688963%40s.whatsapp.net" \
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

## Webhook API

### Your app receives

```json
{
  "id": "msg_abc123",
  "channel": "whatsapp",
  "from": "+972542688963",
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
node echo-server.js
```

Runs on port 3000 and echoes back any message it receives.

## Supported Channels

| Channel | Status | Multi-Service |
|---------|--------|---------------|
| WhatsApp (Baileys) | ✅ Working | Magic codes + groups |
| Telegram (grammY) | ✅ Working | Slash commands |
| Email — Gmail | ✅ Working | — |
| Email — Resend | ✅ Working | — |

## Development

```bash
git clone https://github.com/dirbalak/channelkit.git
cd channelkit
npm install
npm run dev    # starts with auto-reload on code changes
```

## Docker

```bash
docker build -t channelkit .
docker run -v ./config.yaml:/app/config.yaml -v ./auth:/app/auth channelkit
```

## License

MIT
