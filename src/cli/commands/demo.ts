export async function demoCommand(opts: { port: string }) {
  const port = parseInt(opts.port, 10);
  const { resolve } = await import('path');
  const { fork } = await import('child_process');
  const { existsSync } = await import('fs');

  const candidates = [
    resolve(__dirname, '..', '..', '..', 'echo-server.js'),
    resolve(process.cwd(), 'echo-server.js'),
  ];

  const echoPath = candidates.find(p => existsSync(p));

  if (!echoPath) {
    console.error('  ❌ echo-server.js not found');
    process.exit(1);
  }

  console.log(`\n  🔗 Starting demo echo server on port ${port}...\n`);
  const child = fork(echoPath, [], { env: { ...process.env, PORT: String(port) }, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code || 0));
}
