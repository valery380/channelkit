import { API, escHtml } from '../utils.js';

let cachedApiSecret = null;
let sendChannelList = [];

function phoneToJid(phone) {
  return phone.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
}

function updateApiExamples() {
  const channel = document.getElementById("send-channel").value || "whatsapp";
  const phone = document.getElementById("send-number").value.trim() || "+972542688963";
  const jid = phoneToJid(phone);
  const baseUrl = API;
  const secretHeader = cachedApiSecret
    ? '\n  -H "Authorization: Bearer ' + cachedApiSecret + '" \\\n'
    : "\n";

  const curlExample =
    "curl -X POST " + baseUrl + "/api/send/" + channel + "/" + encodeURIComponent(jid) + " \\\n" +
    '  -H "Content-Type: application/json" \\' +
    secretHeader +
    "  -d '{\"text\": \"Hello from the API!\"}'";

  const authLine = cachedApiSecret
    ? '\n    "Authorization": "Bearer ' + cachedApiSecret + '",'
    : "";
  const jsExample =
    "await fetch(\"" + baseUrl + "/api/send/" + channel + "/" + encodeURIComponent(jid) + "\", {\n" +
    '  method: "POST",\n' +
    "  headers: {" + authLine + '\n    "Content-Type": "application/json"\n  },\n' +
    '  body: JSON.stringify({ text: "Hello from the API!" })\n' +
    "});";

  const container = document.getElementById("api-examples-content");
  if (container) {
    container.innerHTML =
      "<h4>cURL</h4><pre><code>" + escHtml(curlExample) + "</code></pre>" +
      "<h4>JavaScript</h4><pre><code>" + escHtml(jsExample) + "</code></pre>" +
      '<p style="font-size:11px;color:var(--dim);margin-top:8px">' +
      "JID format: strip non-digits from phone number, append <code>@s.whatsapp.net</code></p>";
  }
}

export async function openSendModal() {
  // Ensure the modal exists in DOM
  let overlay = document.getElementById("send-overlay");
  if (!overlay) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="send-overlay" id="send-overlay">
        <div class="send-modal">
          <h3>Send WhatsApp Message</h3>
          <label>Channel</label>
          <select id="send-channel"></select>
          <label>Phone number</label>
          <input type="tel" id="send-number" placeholder="+972542688963" />
          <label>Message</label>
          <textarea id="send-text" placeholder="Type your message..."></textarea>
          <div class="send-actions">
            <button class="btn-cancel" id="send-cancel-btn">Cancel</button>
            <button class="btn-send" id="send-btn">Send</button>
          </div>
          <div class="send-status" id="send-status"></div>
          <div class="api-examples">
            <details>
              <summary>API Examples</summary>
              <div id="api-examples-content"></div>
            </details>
          </div>
        </div>
      </div>
    `);
    overlay = document.getElementById("send-overlay");
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSendModal(); });
    document.getElementById("send-cancel-btn").addEventListener("click", closeSendModal);
    document.getElementById("send-btn").addEventListener("click", doSendMessage);
    document.getElementById("send-channel").addEventListener("change", updateApiExamples);
    document.getElementById("send-number").addEventListener("input", updateApiExamples);
  }

  const statusEl = document.getElementById("send-status");
  statusEl.textContent = "";
  statusEl.style.color = "";
  document.getElementById("send-text").value = "";
  document.getElementById("send-btn").disabled = false;

  try {
    const res = await fetch(API + "/api/config");
    const data = await res.json();
    cachedApiSecret = data.api_secret || null;
    sendChannelList = [];
    const sel = document.getElementById("send-channel");
    sel.innerHTML = "";
    for (const [name, cfg] of Object.entries(data.channels)) {
      if (cfg.type === "whatsapp") {
        sendChannelList.push(name);
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      }
    }
    if (sendChannelList.length === 0) {
      sel.innerHTML = '<option value="">No WhatsApp channels</option>';
    }
  } catch {}

  updateApiExamples();
  overlay.classList.add("open");
  document.getElementById("send-number").focus();
}

export function closeSendModal() {
  const overlay = document.getElementById("send-overlay");
  if (overlay) overlay.classList.remove("open");
}

async function doSendMessage() {
  const channel = document.getElementById("send-channel").value;
  const phone = document.getElementById("send-number").value.trim();
  const text = document.getElementById("send-text").value.trim();
  const statusEl = document.getElementById("send-status");
  const btn = document.getElementById("send-btn");

  if (!channel) { statusEl.textContent = "Select a channel"; statusEl.style.color = "var(--red)"; return; }
  if (!phone) { statusEl.textContent = "Enter a phone number"; statusEl.style.color = "var(--red)"; return; }
  if (!text) { statusEl.textContent = "Enter a message"; statusEl.style.color = "var(--red)"; return; }

  btn.disabled = true;
  statusEl.textContent = "Sending...";
  statusEl.style.color = "var(--dim)";

  const jid = phoneToJid(phone);
  const headers = { "Content-Type": "application/json" };
  if (cachedApiSecret) headers["Authorization"] = "Bearer " + cachedApiSecret;

  try {
    const res = await fetch(
      API + "/api/send/" + encodeURIComponent(channel) + "/" + encodeURIComponent(jid),
      { method: "POST", headers, body: JSON.stringify({ text }) }
    );
    const data = await res.json();
    if (res.ok) {
      statusEl.textContent = "Message sent!";
      statusEl.style.color = "var(--green)";
      document.getElementById("send-text").value = "";
    } else {
      statusEl.textContent = data.error || "Failed to send";
      statusEl.style.color = "var(--red)";
    }
  } catch (e) {
    statusEl.textContent = "Error: " + e.message;
    statusEl.style.color = "var(--red)";
  } finally {
    btn.disabled = false;
  }
}
