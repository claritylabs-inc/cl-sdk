# @claritylabs/cl-sdk-docs

Documentation content for [@claritylabs/cl-sdk](https://github.com/claritylabs-inc/cl-sdk). This package contains the raw MDX files and navigation metadata — no rendering code.

This package is versioned with the CL SDK release line. Use `@claritylabs/cl-sdk-docs@3.2.13` with `@claritylabs/cl-sdk@3.2.13`, or keep both packages on the same compatible semver range.

## Usage

Install and read at build time:

```bash
npm install @claritylabs/cl-sdk-docs
```

```ts
import fs from "fs";
import path from "path";

const docsRoot = path.join(
  process.cwd(),
  "node_modules/@claritylabs/cl-sdk-docs",
);
const nav = JSON.parse(fs.readFileSync(path.join(docsRoot, "meta.json"), "utf-8"));
```

## Contents

- `meta.json` — navigation structure (sections and pages)
- `**/*.mdx` — documentation pages with YAML frontmatter

Current documentation includes source-tree extraction, source grounding, query/application/PCE workflows, case workflow primitives, migration notes, API references, storage guidance, and the release changelog.

## Frontmatter

```yaml
title: string       # Page title
description: string # One-line summary
tocSections:        # Optional — table of contents entries
  - { id: string, label: string, level?: 2 | 3 }
```

## MDX components

The MDX files reference these components (provided by the consuming app, not this package):

- `Callout` — info/warning/error boxes
- `Card` / `Cards` — navigation cards
- `Tabs` / `Tab` — tabbed content
- `Section` — scroll-anchor wrapper

## License

MIT
