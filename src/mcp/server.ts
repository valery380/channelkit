import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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
 * Supports two transports:
 * - stdio: for local integrations (Claude Desktop, etc.)
 * - HTTP + SSE (Streamable HTTP): for remote access
 */
export class ChannelKitMcpServer {
  private mcpServer: McpServer;
  private httpApp?: ReturnType<typeof express>;
  private httpServer?: ReturnType<typeof createServer>;
  private transport?: StreamableHTTPServerTransport;

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

    // Single stateful transport per server instance
    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    await this.mcpServer.connect(this.transport);

    // Route all MCP requests through /mcp
    this.httpApp.all('/mcp', async (req, res) => {
      await this.transport!.handleRequest(req, res, req.body);
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
   */
  mountOnExpress(app: ReturnType<typeof express>): void {
    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    // Connect async — fire and forget (tools are already registered)
    this.mcpServer.connect(this.transport).catch((err) => {
      console.error('[mcp] Failed to connect transport:', err);
    });

    app.all('/mcp', async (req, res) => {
      await this.transport!.handleRequest(req, res, req.body);
    });

    console.log('[mcp] MCP endpoint mounted at /mcp');
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
