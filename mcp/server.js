#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDocsBundle() {
  const bundlePath = path.resolve(__dirname, "docs-bundle.json");
  if (!fs.existsSync(bundlePath)) {
    console.error(
      "Warning: docs-bundle.json not found. Run `npx tsx mcp/build-docs.ts` to generate it.\n" +
        "Doc search/read tools will return empty results."
    );
    return { sections: [], pages: [] };
  }
  return JSON.parse(fs.readFileSync(bundlePath, "utf-8"));
}

const docs = loadDocsBundle();

function searchDocs(query, section) {
  const q = query.toLowerCase();
  const wordBoundary = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const results = [];

  for (const page of docs.pages) {
    if (section && !page.slug.startsWith(section + "/") && page.slug !== section) continue;

    const lower = page.content.toLowerCase();
    if (!lower.includes(q)) continue;

    let score = 0;
    let idx = 0;
    while ((idx = lower.indexOf(q, idx)) !== -1) {
      score++;
      idx += q.length;
    }
    const wbMatches = page.content.match(wordBoundary);
    if (wbMatches) score += wbMatches.length * 2;
    if (page.title.toLowerCase().includes(q)) score += 10;

    const firstIdx = lower.indexOf(q);
    const start = Math.max(0, firstIdx - 100);
    const end = Math.min(page.content.length, firstIdx + q.length + 100);
    const excerpt =
      (start > 0 ? "..." : "") +
      page.content.slice(start, end).trim() +
      (end < page.content.length ? "..." : "");

    results.push({ slug: page.slug, title: page.title, excerpt, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 5);
}

function createServer() {
  const server = new McpServer({
    name: "cl-sdk-docs",
    version: "1.0.0",
  });

  server.tool("list_doc_sections", "List all documentation sections and their pages", {}, async () => {
    return {
      content: [{ type: "text", text: JSON.stringify(docs.sections, null, 2) }],
    };
  });

  server.tool(
    "search_docs",
    "Full-text search across CL SDK documentation pages. Returns top 5 matches with context.",
    {
      query: z.string().describe("Search query"),
      section: z.string().optional().describe("Limit to section slug (e.g. 'extraction', 'agent')"),
    },
    async ({ query, section }) => {
      const results = searchDocs(query, section);
      if (results.length === 0) {
        return { content: [{ type: "text", text: "No results found." }] };
      }
      const text = results
        .map((r, i) => `### ${i + 1}. ${r.title} (${r.slug})\nScore: ${r.score}\n\n${r.excerpt}`)
        .join("\n\n---\n\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "read_doc_page",
    "Read a specific documentation page by slug (e.g. 'getting-started/quickstart')",
    {
      slug: z.string().describe("Page slug relative to docs root"),
    },
    async ({ slug }) => {
      const page = docs.pages.find((p) => p.slug === slug);
      if (!page) {
        return {
          content: [{ type: "text", text: `Page not found: ${slug}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: `# ${page.title}\n\n${page.content}` }],
      };
    }
  );

  return server;
}

const useHttp = process.argv.includes("--http") || !!process.env.PORT;

async function main() {
  if (useHttp) {
    const port = parseInt(process.env.PORT || "8787", 10);
    const host = process.env.HOST || "0.0.0.0";
    const app = createMcpExpressApp({ host });

    app.post("/mcp", async (req, res) => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      await transport.close();
      await server.close();
    });

    app.get("/mcp", (_req, res) => {
      res.status(405).json({ error: "Method not allowed. Use POST." });
    });

    app.delete("/mcp", (_req, res) => {
      res.status(405).json({ error: "Method not allowed. Use POST." });
    });

    app.listen(port, () => {
      console.error(`CL SDK MCP server running on http://${host}:${port}/mcp`);
    });
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("CL SDK MCP server running on stdio");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
