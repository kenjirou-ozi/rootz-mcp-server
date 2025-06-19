#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import express from 'express';

const execAsync = promisify(exec);

const REPO_URL = 'https://github.com/kenjirou-ozi/rootz-project.git';
const LOCAL_PATH = './rootz-project';

class RootzMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'rootz-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_file_content',
          description: 'Get the content of a specific file from the Rootz project',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the file relative to project root (e.g., "gsap-exp/header-test.html")',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'analyze_html_structure',
          description: 'Analyze HTML structure and extract CSS classes, IDs, and element hierarchy',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path to the HTML file to analyze',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'sync_repository',
          description: 'Sync the latest version of the Rootz project from GitHub',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'get_file_content':
          return this.getFileContent(request.params.arguments?.path as string);
        case 'analyze_html_structure':
          return this.analyzeHtmlStructure(request.params.arguments?.path as string);
        case 'sync_repository':
          return this.syncRepository();
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  private async syncRepository() {
    try {
      console.log('🔄 Syncing with Rootz repository...');
      
      // Clone or pull latest changes
      try {
        await execAsync(`git clone ${REPO_URL} ${LOCAL_PATH}`);
      } catch (error) {
        // If directory exists, pull latest changes
        await execAsync(`cd ${LOCAL_PATH} && git pull origin main`);
      }

      console.log('✅ Rootz project synced successfully');
      return {
        content: [
          {
            type: 'text',
            text: 'Repository synced successfully with latest changes from GitHub',
          },
        ],
      };
    } catch (error) {
      console.error('❌ Sync failed:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to sync repository: ${error}`
      );
    }
  }

  private async getFileContent(path: string) {
    if (!path) {
      throw new McpError(ErrorCode.InvalidParams, 'Path is required');
    }

    try {
      const { stdout } = await execAsync(`cat "${LOCAL_PATH}/${path}"`);
      
      // File size limit (45KB)
      if (stdout.length > 45000) {
        const truncated = stdout.substring(0, 45000);
        return {
          content: [
            {
              type: 'text',
              text: `File content (truncated to 45KB):\n\n${truncated}\n\n[Content truncated due to size limit]`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `File: ${path}\n\n${stdout}`,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to read file ${path}: ${error}`
      );
    }
  }

  private async analyzeHtmlStructure(path: string) {
    if (!path) {
      throw new McpError(ErrorCode.InvalidParams, 'Path is required');
    }

    try {
      const { stdout } = await execAsync(`cat "${LOCAL_PATH}/${path}"`);
      
      // Extract CSS classes
      const classRegex = /class=["']([^"']+)["']/g;
      const classes = new Set<string>();
      let match;
      while ((match = classRegex.exec(stdout)) !== null) {
        match[1].split(' ').forEach(cls => classes.add(cls.trim()));
      }

      // Extract IDs
      const idRegex = /id=["']([^"']+)["']/g;
      const ids = new Set<string>();
      while ((match = idRegex.exec(stdout)) !== null) {
        ids.add(match[1]);
      }

      // Extract HTML structure
      const tagRegex = /<(\w+)[^>]*>/g;
      const tags = new Set<string>();
      while ((match = tagRegex.exec(stdout)) !== null) {
        tags.add(match[1]);
      }

      const analysis = {
        file: path,
        classes: Array.from(classes).sort(),
        ids: Array.from(ids).sort(),
        tags: Array.from(tags).sort(),
        summary: `Found ${classes.size} CSS classes, ${ids.size} IDs, and ${tags.size} different HTML tags`
      };

      return {
        content: [
          {
            type: 'text',
            text: `HTML Structure Analysis for: ${path}\n\n${JSON.stringify(analysis, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to analyze file ${path}: ${error}`
      );
    }
  }

  async run(): Promise<void> {
    // Initial repository sync
    await this.syncRepository();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('🚀 Rootz MCP Server running...');
  }
}

// Express サーバー追加（Render用ポートバインディング）
const app = express();
const PORT = parseInt(process.env.PORT || '10000', 10);

// ヘルスチェックエンドポイント
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Rootz MCP Server is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Render用ポートバインディング
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 HTTP Server running on port ${PORT}`);
});

// MCP Server 起動
const server = new RootzMCPServer();
server.run().catch(console.error);