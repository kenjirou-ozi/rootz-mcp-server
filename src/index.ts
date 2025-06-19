import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import simpleGit, { SimpleGit } from 'simple-git';
import * as cheerio from 'cheerio';
import * as fs from 'fs/promises';
import * as path from 'path';

class RootzMCPService {
  private git: SimpleGit;
  private localPath: string = './rootz-sync';
  private readonly REPO_URL = 'https://github.com/kenjirou-ozi/rootz-project.git';
  private readonly MAX_FILE_SIZE = 45000;
  
  constructor() {
    this.git = simpleGit();
    this.initializeSync();
  }

  async initializeSync() {
    try {
      console.log('🔄 Syncing with Rootz repository...');
      await fs.rm(this.localPath, { recursive: true, force: true }).catch(() => {});
      await this.git.clone(this.REPO_URL, this.localPath);
      console.log('✅ Rootz project synced successfully');
    } catch (error) {
      console.error('❌ Sync failed:', error);
    }
  }

  async pullLatest(): Promise<void> {
    try {
      const git = simpleGit(this.localPath);
      await git.pull('origin', 'main');
      console.log('📥 Latest changes pulled');
    } catch (error) {
      console.error('❌ Pull failed:', error);
    }
  }

  async getFileContent(filePath: string): Promise<string> {
    await this.pullLatest();
    const fullPath = path.join(this.localPath, filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    
    if (content.length > this.MAX_FILE_SIZE) {
      return content.slice(0, this.MAX_FILE_SIZE) + '\n\n--- [File truncated] ---';
    }
    return content;
  }

  async analyzeHTML(filePath: string) {
    const content = await this.getFileContent(filePath);
    const $ = cheerio.load(content);
    
    const analysis = {
      classes: [] as string[],
      ids: [] as string[],
      elements: [] as Array<{
        tag: string;
        class?: string;
        id?: string;
      }>
    };

    $('*').each((i, elem) => {
      const $elem = $(elem);
      const tagName = (elem as any).tagName?.toLowerCase() || 'unknown';
      
      const classes = $elem.attr('class');
      if (classes) {
        analysis.classes.push(...classes.split(/\s+/));
      }
      
      const id = $elem.attr('id');
      if (id) {
        analysis.ids.push(id);
      }
      
      analysis.elements.push({
        tag: tagName,
        class: classes,
        id: id,
      });
    });

    analysis.classes = [...new Set(analysis.classes)];
    analysis.ids = [...new Set(analysis.ids)];
    
    return analysis;
  }
}

const server = new Server(
  { name: 'rootz-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

const mcpService = new RootzMCPService();

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_file_content',
      description: 'Get content of any file from Rootz project',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Relative path to file' }
        },
        required: ['file_path']
      }
    },
    {
      name: 'analyze_html_structure', 
      description: 'Analyze HTML file for classes and structure',
      inputSchema: {
        type: 'object',
        properties: {
          html_file: { type: 'string', description: 'Path to HTML file' }
        },
        required: ['html_file']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const args = request.params.arguments as any;
    
    switch (request.params.name) {
      case 'get_file_content':
        const content = await mcpService.getFileContent(args.file_path);
        return {
          content: [{
            type: 'text',
            text: `File: ${args.file_path}\n\n${content}`
          }]
        };

      case 'analyze_html_structure':
        const analysis = await mcpService.analyzeHTML(args.html_file);
        return {
          content: [{
            type: 'text',
            text: `HTML Analysis for: ${args.html_file}\n\n${JSON.stringify(analysis, null, 2)}`
          }]
        };

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error: ${error?.message || 'Unknown error'}` }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log('🚀 Rootz MCP Server running...');
}

main().catch(console.error);
