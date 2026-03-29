const http = require("http");
const fs = require("fs");
const path = require("path");

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

/**
 * Parse a multipart/form-data body and return { fields, files }.
 * fields: { name: string_value }
 * files:  { name: { filename, mimetype, data: Buffer } }
 */
function parseMultipart(buf, boundary) {
  const fields = {};
  const files = {};
  const sep = Buffer.from(`--${boundary}`);

  let start = 0;
  const parts = [];
  while (true) {
    const idx = buf.indexOf(sep, start);
    if (idx === -1) break;
    if (start > 0) parts.push(buf.slice(start, idx));
    start = idx + sep.length;
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString();
    let body = part.slice(headerEnd + 4);
    if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
      body = body.slice(0, -2);
    }

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    if (filenameMatch) {
      const mimeMatch = headerStr.match(/Content-Type:\s*(.+)/i);
      files[name] = {
        filename: filenameMatch[1],
        mimetype: mimeMatch ? mimeMatch[1].trim() : "application/octet-stream",
        data: body,
      };
    } else {
      fields[name] = body.toString();
    }
  }
  return { fields, files };
}

function handleRequest(req, msg, savedFile) {
  const channel = msg.channel || "?";
  const from = msg.from || "unknown";
  const text = msg.text || "(no text)";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📨 Incoming message`);
  console.log(`${"=".repeat(60)}`);
  console.log(`   Channel: ${channel}`);
  console.log(`   From:    ${from}`);
  console.log(`   Text:    ${text}`);
  if (msg.media) console.log(`   Media:   ${msg.media.mimetype} (${msg.media.filename || "unnamed"})`);
  if (savedFile) console.log(`   💾 Saved: ${savedFile}`);

  let reply;
  if (channel === "voice") {
    reply = { text: `Echo: ${text}`, voice: true };
  } else if (msg.email) {
    reply = {
      text: `Echo: ${text}`,
      email: { subject: `Re: ${msg.email.subject || "Your message"}` },
    };
  } else {
    reply = { text: `Echo: ${text}` };
  }

  if (savedFile) {
    reply.text += ` (+ attachment: ${path.basename(savedFile)})`;
  }

  console.log(`📤 Reply: ${reply.text}${reply.voice ? " 🔊" : ""}`);
  return reply;
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const contentType = req.headers["content-type"] || "";
    let msg = {};
    let savedFile = null;

    if (contentType.includes("multipart/form-data")) {
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (boundaryMatch) {
        const buf = Buffer.concat(chunks);
        const { fields, files } = parseMultipart(buf, boundaryMatch[1]);

        if (fields.metadata) {
          try { msg = JSON.parse(fields.metadata); } catch {}
        }

        if (files.file) {
          const { filename, mimetype, data } = files.file;
          const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          const dest = path.join(UPLOADS_DIR, safeName);
          fs.writeFileSync(dest, data);
          savedFile = dest;
          msg.media = { mimetype, filename };
        }
      }
    } else {
      const raw = Buffer.concat(chunks).toString();
      if (raw.length) {
        try { msg = JSON.parse(raw); } catch {}
      }
    }

    const reply = handleRequest(req, msg, savedFile);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🔗 ChannelKit Echo Server`);
  console.log(`   Listening on port ${PORT}\n`);
  console.log(`   Every message is echoed back to the sender.`);
  console.log(`   Supports: WhatsApp, Telegram, Email, SMS, Voice`);
  console.log(`   Attachments saved to: ${UPLOADS_DIR}\n`);
  console.log(`   Set your service webhook to: http://localhost:${PORT}\n`);
});
