import { Tunnel } from 'cloudflared';
import { TunnelConfig } from '../config/types';

export class TunnelManager {
  private publicUrl: string | null = null;
  private tunnel: Tunnel | null = null;

  constructor(
    private config: TunnelConfig,
    private targetPort: number,
  ) {}

  getPublicUrl(): string | null {
    return this.publicUrl;
  }

  async start(): Promise<void> {
    if (this.config.public_url && !this.config.token) {
      // Manual public URL without a token — just use it directly
      this.publicUrl = this.config.public_url.replace(/\/$/, '');
      console.log(`📡 Public URL: ${this.publicUrl}`);
      return;
    }

    if (this.config.provider === 'cloudflared' || !this.config.provider) {
      if (this.config.token) {
        await this.startWithToken();
      } else {
        await this.startQuickTunnel();
      }
      return;
    }
  }

  async stop(): Promise<void> {
    if (this.tunnel) {
      this.tunnel.stop();
      this.tunnel = null;
    }
    this.publicUrl = null;
  }

  /** Named tunnel with a Cloudflare Tunnel token — gives a stable URL. */
  private async startWithToken(): Promise<void> {
    // The public URL is pre-configured in the Cloudflare dashboard
    if (this.config.public_url) {
      this.publicUrl = this.config.public_url.replace(/\/$/, '');
    }

    return new Promise<void>((resolve, reject) => {
      const t = Tunnel.withToken(this.config.token!);
      this.tunnel = t;

      const timeout = setTimeout(() => {
        // If no error after 15s, assume the tunnel is running
        console.log(`📡 Tunnel connected — Public URL: ${this.publicUrl || '(check Cloudflare dashboard)'}`);
        resolve();
      }, 15000);

      t.on('connected', () => {
        clearTimeout(timeout);
        console.log(`📡 Tunnel connected — Public URL: ${this.publicUrl || '(check Cloudflare dashboard)'}`);
        resolve();
      });

      t.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start cloudflared: ${err.message}`));
      });

      t.on('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited with code ${code} before connecting`));
      });
    });
  }

  /** Quick tunnel (trycloudflare.com) — random URL each time. */
  private async startQuickTunnel(): Promise<void> {
    const targetUrl = `http://localhost:${this.targetPort}`;

    return new Promise<void>((resolve, reject) => {
      const t = Tunnel.quick(targetUrl);
      this.tunnel = t;

      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for cloudflared tunnel URL (15s)'));
      }, 15000);

      t.on('url', (url) => {
        this.publicUrl = url;
        clearTimeout(timeout);
        console.log(`📡 Public URL: ${this.publicUrl}`);
        resolve();
      });

      t.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start cloudflared: ${err.message}`));
      });

      t.on('exit', (code) => {
        if (!this.publicUrl) {
          clearTimeout(timeout);
          reject(new Error(`cloudflared exited with code ${code} before providing a URL`));
        }
      });
    });
  }
}
