import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import express from 'express';
import { createServer } from 'http';
import { McpContext, registerTools } from './tools';

export interface McpServerConfig {
  enabled?: boolean;
  port?: number;       // HTTP transport port, default 4100
  stdio?: boolean;     // Enable stdio transport (for Claude Desktop etc.)
}

/**
 * ChannelKit MCP Server — exposes ChannelKit functionality as MCP tools.
 *
 * Supports three transports:
 * - stdio: for local integrations (Claude Desktop, etc.)
 * - Streamable HTTP (/mcp): for newer clients
 * - SSE (/sse + /messages): for older clients (Antigravity, etc.)
 */
export class ChannelKitMcpServer {
  private mcpServer: McpServer;
  private httpApp?: ReturnType<typeof express>;
  private httpServer?: ReturnType<typeof createServer>;
  private httpSessions: Map<string, StreamableHTTPServerTransport> = new Map();
  private sseTransports: Map<string, SSEServerTransport> = new Map();

  constructor(private ctx: McpContext, private config: McpServerConfig = {}) {
    this.mcpServer = new McpServer(
      {
        name: 'channelkit',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    registerTools(this.mcpServer, ctx);
  }

  /** Create a fresh McpServer instance with the same tools (for per-connection SSE) */
  private createMcpServer(): McpServer {
    const server = new McpServer(
      { name: 'channelkit', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );
    registerTools(server, this.ctx);
    return server;
  }

  /**
   * Start stdio transport (blocks — reads from stdin).
   * Use this when launched as a subprocess by Claude Desktop or similar.
   */
  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    console.error('[mcp] Stdio transport connected');
  }

  /**
   * Start HTTP + SSE transport on the given port.
   * Mounts on /mcp endpoint.
   */
  async startHttp(port?: number): Promise<void> {
    const httpPort = port || this.config.port || 4100;
    this.httpApp = express();
    this.httpApp.use(express.json());

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    await this.mcpServer.connect(transport);

    this.httpApp.all('/mcp', async (req, res) => {
      await transport.handleRequest(req, res, req.body);
    });

    // Health check
    this.httpApp.get('/health', (_req, res) => {
      res.json({ status: 'ok', transport: 'streamable-http' });
    });

    this.httpServer = createServer(this.httpApp);

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(httpPort, () => {
        console.log(`[mcp] HTTP transport listening on port ${httpPort}`);
        console.log(`[mcp] MCP endpoint: http://localhost:${httpPort}/mcp`);
        resolve();
      });
      this.httpServer!.on('error', reject);
    });
  }

  /**
   * Mount MCP routes on an existing Express app (shares port with API server).
   * Supports both Streamable HTTP (/mcp) and legacy SSE (/sse + /messages).
   * Each client session gets its own McpServer + transport pair.
   */
  async mountOnExpress(app: ReturnType<typeof express>): Promise<void> {
    // CORS headers + OPTIONS preflight are handled globally by mcpCors() middleware
    // registered in ApiServer before externalAccessGuard and mcpAuthCheck.

    // ── Streamable HTTP transport (newer clients like Claude Desktop) ──
    app.all('/mcp', async (req, res) => {
      try {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId) {
          // Existing session — route to its transport
          const transport = this.httpSessions.get(sessionId);
          if (transport) {
            await transport.handleRequest(req, res, req.body);
          } else {
            res.status(400).json({
              jsonrpc: '2.0',
              error: { code: -32600, message: 'Invalid Request: session not found' },
              id: null,
            });
          }
          return;
        }

        // New session — only allow POST with initialize request
        if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32600, message: 'Bad Request: first request must be a POST initialize' },
            id: null,
          });
          return;
        }

        const id = randomUUID();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => id,
        });

        const server = this.createMcpServer();
        await server.connect(transport);

        this.httpSessions.set(id, transport);
        transport.onclose = () => { this.httpSessions.delete(id); };

        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('[mcp] Error handling /mcp request:', error);
        if (!(res as any).headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    });

    // ── Legacy SSE transport (Antigravity, older clients) ──
    app.get('/sse', async (req, res) => {
      try {
        const transport = new SSEServerTransport('/messages', res as any);
        this.sseTransports.set(transport.sessionId, transport);

        (res as any).on('close', () => {
          this.sseTransports.delete(transport.sessionId);
        });

        const server = this.createMcpServer();
        await server.connect(transport);
      } catch (error) {
        console.error('[mcp] Error handling /sse request:', error);
        if (!(res as any).headersSent) {
          res.status(500).json({ error: 'Failed to establish SSE connection' });
        }
      }
    });

    app.post('/messages', async (req, res) => {
      try {
        const sessionId = req.query.sessionId as string;
        const transport = this.sseTransports.get(sessionId);
        if (transport) {
          await transport.handlePostMessage(req as any, res as any, req.body);
        } else {
          res.status(400).json({ error: 'No active SSE session for this sessionId' });
        }
      } catch (error) {
        console.error('[mcp] Error handling /messages request:', error);
        if (!(res as any).headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });

    console.log('[mcp] MCP endpoints mounted: /mcp (Streamable HTTP), /sse (SSE)');
  }

  async stop(): Promise<void> {
    try {
      await this.mcpServer.close();
    } catch {}
    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
  }
}
