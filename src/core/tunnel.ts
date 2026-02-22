import { ChildProcess, spawn } from 'child_process';
import { TunnelConfig } from '../config/types';

export class TunnelManager {
  private publicUrl: string | null = null;
  private process: ChildProcess | null = null;

  constructor(
    private config: TunnelConfig,
    private targetPort: number,
  ) {}

  getPublicUrl(): string | null {
    return this.publicUrl;
  }

  async start(): Promise<void> {
    if (this.config.public_url) {
      // Manual public URL — just use it directly
      this.publicUrl = this.config.public_url.replace(/\/$/, '');
      console.log(`📡 Public URL: ${this.publicUrl}`);
      return;
    }

    if (this.config.provider === 'cloudflared') {
      await this.startCloudflared();
      return;
    }
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private async startCloudflared(): Promise<void> {
    const targetUrl = `http://localhost:${this.targetPort}`;

    // Try `cloudflared` from PATH first, fallback to full path
    let binary = 'cloudflared';
    try {
      const { execSync } = await import('child_process');
      execSync('which cloudflared', { stdio: 'ignore' });
    } catch {
      binary = '/Users/user/bin/cloudflared';
    }

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(binary, ['tunnel', '--url', targetUrl], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.process = proc;

      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for cloudflared tunnel URL (15s)'));
      }, 15000);

      const handleOutput = (data: Buffer) => {
        const text = data.toString();
        const match = text.match(/https:\/\/[^\s]*trycloudflare\.com/);
        if (match && !this.publicUrl) {
          this.publicUrl = match[0];
          clearTimeout(timeout);
          console.log(`📡 Public URL: ${this.publicUrl}`);
          resolve();
        }
      };

      proc.stdout?.on('data', handleOutput);
      proc.stderr?.on('data', handleOutput);

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start cloudflared: ${err.message}`));
      });

      proc.on('exit', (code) => {
        if (!this.publicUrl) {
          clearTimeout(timeout);
          reject(new Error(`cloudflared exited with code ${code} before providing a URL`));
        }
      });
    });
  }
}
