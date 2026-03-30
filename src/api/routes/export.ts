import { Express } from 'express';
import { ServerContext } from '../types';
import { execFile } from 'child_process';
import { join } from 'path';
import { existsSync, mkdirSync, unlinkSync, createReadStream } from 'fs';
import { writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { CHANNELKIT_HOME, DEFAULT_CONFIG_PATH, DEFAULT_AUTH_DIR, DEFAULT_DATA_DIR } from '../../paths';

export function registerExportRoutes(app: Express, ctx: ServerContext): void {
  // GET /api/export — download a ZIP backup of config, groups, and auth
  app.get('/api/export', async (_req, res) => {
    const configPath = ctx.configPath || DEFAULT_CONFIG_PATH;
    const groupsPath = join(DEFAULT_DATA_DIR, 'groups.json');
    const authDir = DEFAULT_AUTH_DIR;

    // Collect files to include
    const filesToZip: string[] = [];
    if (existsSync(configPath)) filesToZip.push(configPath);
    if (existsSync(groupsPath)) filesToZip.push(groupsPath);

    // Build relative paths for zip: we'll zip from CHANNELKIT_HOME
    const relPaths: string[] = [];
    if (existsSync(configPath)) relPaths.push('config.yaml');
    if (existsSync(groupsPath)) relPaths.push(join('data', 'groups.json'));
    if (existsSync(authDir)) relPaths.push('auth');

    if (relPaths.length === 0) {
      res.status(404).json({ error: 'No data to export' });
      return;
    }

    const date = new Date().toISOString().slice(0, 10);
    const filename = `channelkit-backup-${date}.zip`;
    const tmpPath = join(tmpdir(), `ck-export-${randomBytes(4).toString('hex')}.zip`);

    try {
      await new Promise<void>((resolve, reject) => {
        execFile('zip', ['-r', tmpPath, ...relPaths], { cwd: CHANNELKIT_HOME }, (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(stderr || err.message));
          } else {
            resolve();
          }
        });
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      const stream = createReadStream(tmpPath);
      stream.pipe(res);
      stream.on('end', () => {
        try { unlinkSync(tmpPath); } catch {}
      });
      stream.on('error', () => {
        try { unlinkSync(tmpPath); } catch {}
        if (!res.headersSent) res.status(500).json({ error: 'Failed to stream export' });
      });
    } catch (err: any) {
      try { unlinkSync(tmpPath); } catch {}
      console.error('[export]', err);
      res.status(500).json({ error: err.message || 'Failed to create export' });
    }
  });

  // POST /api/import — upload a ZIP backup and extract to ~/.channelkit/
  app.post('/api/import', async (req, res) => {
    // Accept raw ZIP body (Content-Type: application/zip or application/octet-stream)
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      const zipBuffer = Buffer.concat(chunks);
      if (zipBuffer.length === 0) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const tmpPath = join(tmpdir(), `ck-import-${randomBytes(4).toString('hex')}.zip`);
      try {
        await writeFile(tmpPath, zipBuffer);

        // Ensure CHANNELKIT_HOME exists
        if (!existsSync(CHANNELKIT_HOME)) {
          mkdirSync(CHANNELKIT_HOME, { recursive: true });
        }

        await new Promise<void>((resolve, reject) => {
          execFile('unzip', ['-o', tmpPath, '-d', CHANNELKIT_HOME], (err, _stdout, stderr) => {
            if (err) {
              reject(new Error(stderr || err.message));
            } else {
              resolve();
            }
          });
        });

        await rm(tmpPath, { force: true });
        res.json({ ok: true, message: 'Import successful. Please restart ChannelKit for changes to take effect.' });
      } catch (err: any) {
        await rm(tmpPath, { force: true }).catch(() => {});
        console.error('[import]', err);
        res.status(500).json({ error: err.message || 'Failed to import' });
      }
    });
  });
}
