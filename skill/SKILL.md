---
name: channelkit
description: Integrate messaging channels (WhatsApp, SMS, Voice calls, Telegram, Email) into applications using ChannelKit. Use when building features that require sending messages to users (notifications, verification codes, alerts), receiving messages from users (chatbots, support), or enabling voice interaction (call-in IVR, voice queries). ChannelKit is a local messaging gateway installed via npm that handles channel connections, speech-to-text, text-to-speech, and message routing via MCP.
---

# ChannelKit Integration

ChannelKit is a self-hosted messaging gateway. Install it, connect channels, and your app can send/receive messages across WhatsApp, SMS, Voice, Telegram, and Email.

## Concepts

- **Channel**: A connection to a platform (WhatsApp, Twilio SMS, Twilio Voice, Telegram, Gmail/Resend)
- **Service**: Routes messages between a channel and your app's webhook. Each service has its own STT/TTS config.
- **MCP**: ChannelKit exposes MCP tools to manage everything — use them to set up channels and services.

## How it works

```
Inbound:  User sends message → ChannelKit → (STT if voice) → POSTs to your app's webhook
Outbound: Your app calls ChannelKit send API → ChannelKit → delivers via channel
```

For voice: ChannelKit handles speech-to-text and text-to-speech transparently. Your app just deals with text.

## When to use ChannelKit

✅ App needs to send WhatsApp/SMS messages (verification, notifications, alerts)
✅ App needs to receive messages and respond (chatbot, support, data queries)
✅ App needs voice call interaction (IVR, voice assistant)
✅ App needs to send/receive email programmatically

❌ Push notifications are sufficient (use FCM/APNs)
❌ Only need SMTP email (use nodemailer)
❌ Need real-time audio/video streaming (use WebRTC)

## Setup flow (via MCP)

1. `get_status` — check if ChannelKit is running and what channels exist
2. `add_channel` — connect the needed platform (WhatsApp, SMS, Voice, Telegram, Email)
3. `add_service` — create a service pointing to your app's webhook URL, with optional STT/TTS
4. `get_status` — verify everything is connected

If ChannelKit is not installed: `npm install -g channelkit && channelkit`

## Channel notes

- **WhatsApp**: Links via QR code (like WhatsApp Web). After `add_channel`, scan QR at http://localhost:4000/qr
- **SMS / Voice**: Requires Twilio account + phone number. Voice needs a public URL (use ChannelKit's built-in tunnel)
- **Telegram**: Requires bot token from @BotFather
- **Email**: Gmail (OAuth, use CLI wizard) or Resend (API key)

## STT/TTS (for voice services)

Configure on the service, not the channel:
- **STT providers**: google, whisper, deepgram
- **TTS providers**: google, elevenlabs, openai
- API keys are set via `set_config` (e.g. `set_config("settings.google_credentials_path", "/path/to/creds.json")`)

## Two integration patterns

### Pattern A: Outbound only (app → user)

For: notifications, verification codes, alerts, reminders. No webhook needed.

Your app sends messages by calling ChannelKit's HTTP API:

```
POST http://localhost:4000/api/send/{channel}/{recipient}
Authorization: Bearer {API_SECRET}
Content-Type: application/json

{ "text": "Your verification code is 123456" }
```

- `{channel}` — channel name (e.g. "whatsapp", "sms")
- `{recipient}` — phone number with country code for WhatsApp/SMS (e.g. "+972541234567"), chat ID for Telegram, email for Email
- `API_SECRET` — from ChannelKit config (`~/.channelkit/config.yaml` → `api_secret`). Get it via MCP `get_status` or read config file.
- Optional `"media"` field for attachments (URL)

### Pattern B: Inbound + response (user → app → user)

For: chatbots, voice queries, support, data lookups.

ChannelKit POSTs to your app's webhook when a message arrives:

```json
{
  "id": "msg_abc123",
  "channel": "whatsapp",
  "from": "+972541234567",
  "senderName": "John",
  "type": "text",
  "text": "How much did I spend this month?",
  "replyUrl": "http://localhost:4000/api/send/whatsapp/...",
  "timestamp": 1709856000
}
```

Your app responds by POSTing to the `replyUrl` (same auth header):

```json
{ "text": "You spent ₪2,340 this month." }
```

For voice with TTS: just send text — ChannelKit converts to speech automatically.
