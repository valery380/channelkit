import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { Channel } from '../channels/base';

export async function restartProcess(channels: Map<string, Channel>): Promise<void> {
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
  await Promise.allSettled([...channels.values()].map(ch => ch.disconnect()));

  const child = spawn(cmd, args, {
    detached: true,
    stdio: 'inherit',
    env: process.env,
    cwd: process.cwd(),
  });
  child.unref();
  process.exit(0);
}
