# @claritylabs/cl-sdk-mcp

[![npm](https://img.shields.io/npm/v/@claritylabs/cl-sdk-mcp)](https://www.npmjs.com/package/@claritylabs/cl-sdk-mcp)
[![GitHub](https://img.shields.io/github/license/claritylabs-inc/cl-sdk)](https://github.com/claritylabs-inc/cl-sdk/tree/master/mcp)

MCP server for the [CL SDK](https://www.npmjs.com/package/@claritylabs/cl-sdk) ([GitHub](https://github.com/claritylabs-inc/cl-sdk)). Provides documentation search and reference as [Model Context Protocol](https://modelcontextprotocol.io/) tools for AI coding assistants like Claude Code, Cursor, and Windsurf.

No API keys required — this is a pure documentation server to help AI assistants write correct CL SDK integration code.

## Setup

### Claude Code

Add to `.claude/mcp.json` (project or global `~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "cl-sdk": {
      "command": "npx",
      "args": ["@claritylabs/cl-sdk-mcp"]
    }
  }
}
```

### Cursor / Windsurf

Add to your MCP settings (`~/.cursor/mcp.json` or equivalent):

```json
{
  "mcpServers": {
    "cl-sdk": {
      "command": "npx",
      "args": ["@claritylabs/cl-sdk-mcp"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `search_docs` | Full-text search across CL SDK docs, returns top 5 matches with context |
| `read_doc_page` | Read a doc page by slug (e.g. `getting-started/quickstart`) |
| `list_doc_sections` | List all sections and pages |

## Docs

Full documentation: [cl-sdk.claritylabs.inc/docs](https://cl-sdk.claritylabs.inc/docs)

## Links

- [npm: @claritylabs/cl-sdk-mcp](https://www.npmjs.com/package/@claritylabs/cl-sdk-mcp)
- [npm: @claritylabs/cl-sdk](https://www.npmjs.com/package/@claritylabs/cl-sdk)
- [GitHub: cl-sdk](https://github.com/claritylabs-inc/cl-sdk) (this repo)
