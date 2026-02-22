const http = require("http");

const server = http.createServer((req, res) => {
  let body = [];
  req.on("data", (c) => body.push(c));
  req.on("end", () => {
    const msg = body.length ? JSON.parse(body.join("")) : {};
    const channel = msg.channel || "?";
    const type = msg.type || "text";
    const from = msg.from || "?";
    const text = msg.text || "(no text)";

    console.log(`\n📨 ${req.url} ← [${channel}] ${from}: ${text}`);
    if (type !== "text") console.log(`   Type: ${type}`);
    if (msg.senderName) console.log(`   Name: ${msg.senderName}`);
    if (msg.email?.subject) console.log(`   Subject: ${msg.email.subject}`);
    if (msg.media) console.log(`   Media: ${msg.media.mimetype || "unknown"} (${msg.media.buffer ? "buffer" : msg.media.url || "no data"})`);

    let reply;
    if (req.url.startsWith("/expenses")) {
      reply = { text: "💰 Onkosto: got your message!" };
    } else if (req.url.startsWith("/home")) {
      reply = { text: "🏠 Smart Home: got your message!" };
    } else if (req.url.startsWith("/support")) {
      // Demo: echo back with voice (triggers TTS if configured)
      reply = { text: `You said: ${text}`, voice: true };
    } else if (req.url.startsWith("/email")) {
      reply = {
        text: `Thanks for your email!`,
        email: { subject: `Re: ${msg.email?.subject || "Your message"}` },
      };
    } else if (channel === "voice") {
      // Voice: respond with text (will be spoken back via TTS or <Say>)
      reply = { text: `You said: ${text}`, voice: true };
    } else {
      reply = { text: `Echo [${channel}]: ${text}` };
    }

    console.log(`📤 ${reply.text}${reply.voice ? " 🔊" : ""}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply));
  });
});

server.listen(3000, () => {
  console.log("🔗 Echo server listening on port 3000\n");
  console.log("   Routes:");
  console.log("   /expenses → Onkosto (text reply)");
  console.log("   /home     → Smart Home (text reply)");
  console.log("   /support  → Support (voice reply — TTS)");
  console.log("   /email    → Email (reply with subject)");
  console.log("   /*        → Generic echo");
  console.log("   voice     → Echo with TTS 🔊\n");
  console.log("   Supports: WhatsApp, Telegram, Gmail, Resend, SMS, Voice\n");
});
