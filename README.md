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
# Install
npm install channelkit

# Copy and edit config
cp config.example.yaml config.yaml

# Start
npx channelkit start
```

Scan the QR code in your terminal to connect WhatsApp. That's it.

## Config

```yaml
channels:
  main:
    type: whatsapp
    number: "+44..."

routes:
  - channel: whatsapp
    match: "*"
    webhook: "http://localhost:3000/api/chat"
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
  "from": "+972542688963",
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
npm run dev
```

## Docker

```bash
docker build -t channelkit .
docker run -v ./config.yaml:/app/config.yaml -v ./auth:/app/auth channelkit
```

## License

MIT
