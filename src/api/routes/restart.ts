import { Express } from 'express';
import { ServerContext } from '../types';

export function registerRestartRoutes(app: Express, ctx: ServerContext): void {
  app.post('/api/restart', (_req, res) => {
    res.json({ ok: true });
    setTimeout(async () => {
      const { spawn } = await import('child_process');
      const { join } = await import('path');
      const { existsSync } = await import('fs');
      const argv1 = process.argv[1] || '';
      const tsxBin = join(process.cwd(), 'node_modules', '.bin', 'tsx');
      const tsxCmd = existsSync(tsxBin) ? tsxBin : 'tsx';
      let cmd: string;
      let args: string[];
      if (argv1.endsWith('.ts')) {
        cmd = tsxCmd;
        args = process.argv.slice(1);
      } else if (argv1.includes('tsx')) {
        cmd = tsxCmd;
        args = process.argv.slice(2);
      } else {
        cmd = process.execPath;
        args = process.argv.slice(1);
      }
      await Promise.allSettled([...ctx.channels.values()].map(ch => ch.disconnect()));

      const child = spawn(cmd, args, {
        detached: true,
        stdio: 'inherit',
        env: process.env,
        cwd: process.cwd(),
      });
      child.unref();
      process.exit(0);
    }, 300);
  });
}
