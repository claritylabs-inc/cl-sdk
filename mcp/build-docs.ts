/**
 * Bundles MDX docs content into a JSON file for the standalone MCP server.
 * Run: npx tsx mcp/build-docs.ts
 */
import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";

const DOCS_ROOT = path.resolve(__dirname, "../docs-pkg");
const OUT_PATH = path.resolve(__dirname, "docs-bundle.json");

interface DocPage {
  slug: string;
  title: string;
  description: string;
  content: string;
}

interface DocSection {
  title: string;
  slug: string;
  pages: string[];
}

function walkMdx(dir: string, base = ""): DocPage[] {
  const results: DocPage[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMdx(fullPath, base ? `${base}/${entry.name}` : entry.name));
    } else if (entry.name.endsWith(".mdx")) {
      const slug = base
        ? entry.name === "index.mdx"
          ? base
          : `${base}/${entry.name.replace(/\.mdx$/, "")}`
        : entry.name.replace(/\.mdx$/, "");
      const raw = fs.readFileSync(fullPath, "utf-8");
      const { data, content } = matter(raw);
      // Strip import lines (components don't exist in standalone mode)
      const cleaned = content
        .split("\n")
        .filter((line) => !line.startsWith("import "))
        .join("\n")
        .trim();
      results.push({
        slug,
        title: (data.title as string) ?? slug,
        description: (data.description as string) ?? "",
        content: cleaned,
      });
    }
  }
  return results;
}

function walkSections(dir: string): DocSection[] {
  const sections: DocSection[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(dir, entry.name, "meta.json");
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        sections.push({
          title: meta.title ?? entry.name,
          slug: entry.name,
          pages: meta.pages ?? [],
        });
      } catch {}
    }
  }
  return sections;
}

const bundle = {
  generatedAt: new Date().toISOString(),
  sections: walkSections(DOCS_ROOT),
  pages: walkMdx(DOCS_ROOT),
};

fs.writeFileSync(OUT_PATH, JSON.stringify(bundle, null, 2));
console.log(`Bundled ${bundle.pages.length} pages, ${bundle.sections.length} sections → ${OUT_PATH}`);
