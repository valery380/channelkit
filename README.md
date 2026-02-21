# ChannelKit

A self-hosted messaging gateway that connects chat channels (WhatsApp, Telegram, and more) to any application via webhooks.

Think **nginx, but for chat.**

```
📱 WhatsApp ──┐
💬 Telegram ──┤──→ ChannelKit ──→ Your App (webhook)
📞 Phone    ──┤     (unified JSON)
✉️ Email    ──┘
```

Your app receives every message in a **unified JSON format**, regardless of source channel. Respond with text or media, and ChannelKit routes it back through the originating channel.

## Quick Start

```bash
git clone https://github.com/dirbalak/channelkit.git
cd channelkit
npm install
npm run init
```

The interactive wizard will guide you through setup — pick a channel, enter your number, set a webhook URL, and you're done.

### Step by step

**1. Run the setup wizard:**
```bash
npm run init
```
This creates `config.yaml` and starts ChannelKit.

**2. Scan the QR code** that appears in the terminal with WhatsApp (Settings → Linked Devices → Link a Device).

**3. Start a test webhook** (in a separate terminal):
```bash
node echo-server.js
```
This runs a simple server on port 3000 that echoes back messages. Two endpoints included: `/expenses` and `/home`.

**4. Send a WhatsApp message** to the connected number — you'll see it in the echo server and get a reply back!

### Running after initial setup

```bash
npm start                  # start with existing config
npm run dev                # start with auto-reload (development)
npm start -- -c my.yaml    # use a custom config file
```

> The QR scan is only needed once. Auth is saved in `./auth/` and persists across restarts.

## Services & Onboarding

ChannelKit can expose multiple services on a single WhatsApp number using magic codes and auto-created groups.

### Add a service
```bash
npm run service add
# → Service name: Onkosto
# → Magic code: ONKOSTO
# → Webhook: http://localhost:3000/expenses
# → ✅ Added! Share: wa.me/447476994189?text=ONKOSTO
```

### How it works
1. User sends "ONKOSTO" to your WhatsApp number (or clicks the `wa.me` link)
2. ChannelKit creates a group "Onkosto - <User Name>"
3. All messages in that group are routed to the service's webhook
4. Each service gets its own group per user — no confusion

### Manage services
```bash
npm run service list              # list all services
npm run service -- remove onkosto # remove a service
```

## Config

```yaml
channels:
  whatsapp:
    type: whatsapp
    number: "+972..."

routes:
  - channel: whatsapp
    match: "*"
    webhook: "http://localhost:3000/api/chat"

onboarding:
  codes:
    - code: "ONKOSTO"
      name: "Onkosto"
      webhook: "http://localhost:3000/expenses"
    - code: "SMARTHOME"
      name: "Smart Home"
      webhook: "http://localhost:8080/home"
```

## Async Messaging API

Every webhook payload includes a `replyUrl` field — a callback endpoint your service can use to send messages at any time, not just as a response.

### Webhook payload with replyUrl

```json
{
  "id": "msg_abc123",
  "channel": "whatsapp",
  "from": "+972501234567",
  "text": "What's my balance?",
  "replyUrl": "http://localhost:4000/api/send/whatsapp/972501234567%40s.whatsapp.net"
}
```

### Sync response (as before)
Return a response from your webhook — it gets sent back immediately:
```json
{ "text": "Your balance is $42.00" }
```

### Async message (anytime)
Store the `replyUrl` and send messages whenever you want:
```bash
curl -X POST "http://localhost:4000/api/send/whatsapp/972501234567%40s.whatsapp.net" \
  -H "Content-Type: application/json" \
  -d '{"text": "Your invoice was approved! ✅"}'
```

This is useful for:
- **Notifications** — send alerts when something happens in your system
- **Long-running tasks** — acknowledge immediately, send results later
- **Proactive messages** — reminders, status updates, scheduled messages

The API server runs on port 4000 by default. Change it in config:
```yaml
apiPort: 5000
```

### Health check
```
GET http://localhost:4000/api/health
→ { "status": "ok", "channels": ["whatsapp"] }
```

### Routing

Routes match messages by channel and pattern. Patterns support `*` (match all), pipe-separated keywords (`status|temp`), or regex.

```yaml
routes:
  - channel: whatsapp
    match: "*"
    webhook: "http://localhost:3000/api/chat"

  - channel: telegram
    match: "status|temperature|lights"
    webhook: "http://localhost:8080/smart-home"
```

## Webhook API

### Your app receives

```json
{
  "id": "msg_abc123",
  "channel": "whatsapp",
  "from": "+972501234567",
  "type": "text",
  "text": "What's the temperature in the kitchen?",
  "timestamp": 1708420200,
  "groupId": null,
  "groupName": null
}
```

### Your app responds

```json
{
  "text": "Kitchen: 23°C 🌡️"
}
```

That's the entire integration. Your app doesn't know or care whether the message came from WhatsApp, Telegram, or a phone call.

## Supported Channels

| Channel | Status |
|---------|--------|
| WhatsApp (Baileys) | ✅ Working |
| Telegram | 🔜 Placeholder |
| Email | 🔜 Planned |
| Voice/SMS | 🔜 Planned |

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
