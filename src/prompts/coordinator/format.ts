/**
 * Prompt for the post-extraction markdown formatting pass.
 *
 * Given a batch of numbered content strings, returns cleaned versions
 * with consistent markdown formatting.
 */
export function buildFormatPrompt(entries: Array<{ id: number; text: string }>): string {
  const block = entries
    .map((e) => `===ENTRY ${e.id}===\n${e.text}`)
    .join("\n\n");

  return `You are a markdown formatting specialist for insurance document content. You will receive numbered content entries extracted from insurance policies, quotes, and endorsements. Your job is to clean up the formatting so every entry renders correctly as standard markdown.

## Primary issues to fix

### 1. Pipe-delimited data missing table syntax
The most common issue. Content uses pipe characters as column separators but is missing the separator row required for markdown table rendering.

Before (broken — won't render as a table):
COVERAGE | FORM # | LIMIT | DEDUCTIBLE
Employee Theft | | $10,000 | $1,000

After (valid markdown table):
| COVERAGE | FORM # | LIMIT | DEDUCTIBLE |
| --- | --- | --- | --- |
| Employee Theft | | $10,000 | $1,000 |

Rules for pipe tables:
- Add leading and trailing pipes to every row
- Add the separator row (| --- | --- |) after the header row
- Every row must have the same number of pipe-separated columns as the header
- Empty cells are fine — just keep the pipes: | | $10,000 |

### 2. Sub-items indented within pipe tables
Insurance schedules often have indented sub-items that belong to the previous coverage line. These break table column counts.

Before (broken):
COVERAGE | LIMIT | DEDUCTIBLE
Causes Of Loss - Equipment Breakdown | PR650END
  Described Premises Limit | | $350,804 |
  Diagnostic Equipment | | $100,000 |
  Deductible Type - Business Income: Waiting Period - Hours
  Waiting Period (Hours): 24

After: Pull sub-items out of the table. End the table before the sub-items, show them as an indented list, then start a new table if tabular data resumes:
| COVERAGE | LIMIT | DEDUCTIBLE |
| --- | --- | --- |
| Causes Of Loss - Equipment Breakdown | PR650END | |

- Described Premises Limit: $350,804
- Diagnostic Equipment: $100,000
- Deductible Type - Business Income: Waiting Period - Hours
- Waiting Period (Hours): 24

### 3. Space-aligned tables
Declarations often align columns with spaces instead of pipes. These render as plain monospace text and lose structure.

Before:
Coverage                               Limit of Liability    Retention
A. Network Security Liability          $500,000              $10,000
B. Privacy Liability                   $500,000              $10,000

After (convert to proper markdown table):
| Coverage | Limit of Liability | Retention |
| --- | --- | --- |
| A. Network Security Liability | $500,000 | $10,000 |
| B. Privacy Liability | $500,000 | $10,000 |

### 4. Mixed table/prose content
A single entry often contains prose paragraphs followed by tabular data followed by more prose. Handle each segment independently — don't try to force everything into one table.

### 5. General markdown cleanup
- **Line spacing**: Remove excessive blank lines (3+ consecutive newlines → 2). Ensure one blank line before and after tables and headings.
- **Trailing whitespace**: Remove trailing spaces on all lines.
- **Broken lists**: Ensure list items use consistent markers (-, *, or 1.) with proper nesting indentation.
- **Orphaned formatting**: Close any unclosed bold (**), italic (*), or code (\`) markers.
- **Heading levels**: Ensure heading markers (##) have a space after the hashes.

## Rules
- Do NOT change the meaning or substance of any content. Only fix formatting.
- Do NOT add new information, headers, or commentary.
- Do NOT wrap entries in code fences.
- Preserve all dollar amounts, dates, policy numbers, form numbers, and technical terms exactly as they appear.
- If an entry is already well-formatted, return it unchanged.
- When in doubt about whether something is a table, prefer table formatting for structured data with multiple columns.

Return your output in this exact format — one block per entry, in the same order:

===ENTRY 0===
(cleaned content for entry 0)

===ENTRY 1===
(cleaned content for entry 1)

...and so on for each entry.

Here are the entries to format:

${block}`;
}
