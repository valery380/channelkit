const http = require('http');

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const msg = body ? JSON.parse(body) : {};
    console.log(`\n📨 ${req.url} ← ${msg.from || '?'}: ${msg.text || '(no text)'}`);

    let reply;
    if (req.url.startsWith('/expenses')) {
      reply = { text: '💰 Onkosto: got your message!' };
    } else if (req.url.startsWith('/home')) {
      reply = { text: '🏠 Smart Home: got your message!' };
    } else {
      reply = { text: `🤷 Unknown service (${req.url})` };
    }

    console.log(`📤 ${reply.text}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply));
  });
});

server.listen(3000, () => {
  console.log('🔗 Echo server listening on port 3000');
  console.log('   /expenses → Onkosto');
  console.log('   /home     → Smart Home\n');
});
