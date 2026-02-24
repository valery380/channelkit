import express, { Express } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { ServerContext } from '../types';

export function registerDashboardRoutes(app: Express, ctx: ServerContext): void {
  // GET /qr — WhatsApp QR code page
  app.get('/qr', async (_req, res) => {
    if (!ctx.latestQR) {
      res.send(`
        <html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:#fff">
          <div style="text-align:center">
            <h2>No QR code available</h2>
            <p>WhatsApp is either already connected or not configured.</p>
            <script>setTimeout(() => location.reload(), 3000)</script>
          </div>
        </body></html>
      `);
      return;
    }
    try {
      const QRCode = await import('qrcode');
      const dataUrl = await QRCode.toDataURL(ctx.latestQR, { width: 400, margin: 2 });
      res.send(`
        <html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:#fff">
          <div style="text-align:center">
            <h2>📱 Scan with WhatsApp</h2>
            <img src="${dataUrl}" style="border-radius:12px;margin:20px 0"/>
            <p style="color:#888">Settings → Linked Devices → Link a Device</p>
            <script>setTimeout(() => location.reload(), 15000)</script>
          </div>
        </body></html>
      `);
    } catch {
      res.send(`<html><body><pre>${ctx.latestQR}</pre></body></html>`);
    }
  });

  // Serve the entire dashboard directory as static files under /dashboard
  // Try compiled path first, then source path for dev mode
  const compiledDashboardDir = join(__dirname, '..', '..', 'dashboard');
  const srcDashboardDir = join(__dirname, '..', '..', '..', 'src', 'dashboard');
  const dashboardDir = existsSync(join(compiledDashboardDir, 'index.html'))
    ? compiledDashboardDir
    : srcDashboardDir;

  // Serve static files (JS, CSS, etc.) under /dashboard/
  app.use('/dashboard', express.static(dashboardDir, {
    extensions: ['html'],
    index: 'index.html',
  }));
}
