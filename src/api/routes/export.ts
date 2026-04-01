import { Express } from 'express';
import { ServerContext } from '../types';
import { execFile } from 'child_process';
import { join, resolve, normalize } from 'path';
import { existsSync, mkdirSync, unlinkSync, createReadStream } from 'fs';
import { writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { CHANNELKIT_HOME, DEFAULT_CONFIG_PATH, DEFAULT_AUTH_DIR, DEFAULT_DATA_DIR } from '../../paths';

const MAX_IMPORT_SIZE = 50 * 1024 * 1024; // 50MB

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
    let totalSize = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_IMPORT_SIZE) {
        aborted = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', async () => {
      if (aborted) {
        res.status(413).json({ error: `Upload too large (max ${MAX_IMPORT_SIZE / 1024 / 1024}MB)` });
        return;
      }
      const zipBuffer = Buffer.concat(chunks);
      if (zipBuffer.length === 0) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const tmpPath = join(tmpdir(), `ck-import-${randomBytes(4).toString('hex')}.zip`);
      try {
        await writeFile(tmpPath, zipBuffer);

        // Validate ZIP contents — reject any paths with ".." or absolute paths
        const listing = await new Promise<string>((resolveP, reject) => {
          execFile('unzip', ['-l', tmpPath], (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolveP(stdout);
          });
        });

        const resolvedHome = resolve(CHANNELKIT_HOME);
        const lines = listing.split('\n');
        for (const line of lines) {
          // unzip -l format: "  length  date  time  name"
          const match = line.match(/^\s*\d+\s+\d{2}-\d{2}-\d{2,4}\s+\d{2}:\d{2}\s+(.+)$/);
          if (!match) continue;
          const entryPath = match[1].trim();
          if (entryPath.includes('..') || entryPath.startsWith('/')) {
            await rm(tmpPath, { force: true });
            res.status(400).json({ error: `Rejected: ZIP contains unsafe path "${entryPath}"` });
            return;
          }
          // Double-check resolved path stays within CHANNELKIT_HOME
          const resolved = resolve(CHANNELKIT_HOME, entryPath);
          if (!resolved.startsWith(resolvedHome + '/') && resolved !== resolvedHome) {
            await rm(tmpPath, { force: true });
            res.status(400).json({ error: `Rejected: ZIP entry "${entryPath}" would extract outside home directory` });
            return;
          }
        }

        // Ensure CHANNELKIT_HOME exists
        if (!existsSync(CHANNELKIT_HOME)) {
          mkdirSync(CHANNELKIT_HOME, { recursive: true });
        }

        await new Promise<void>((resolveP, reject) => {
          execFile('unzip', ['-o', tmpPath, '-d', CHANNELKIT_HOME], (err, _stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolveP();
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
