import { compressToolOutput } from './src/agent';
import { countTokens } from './src/engine/counter';

// Helper to calculate and print stats
function measure(name: string, data: string, toolHint: string) {
  const result = compressToolOutput(data, { tool: toolHint });
  const before = result.tokensBefore;
  const after = result.tokensAfter;
  const reduction = Math.round((1 - after / before) * 100);
  console.log(`| ${name} | ${before.toLocaleString()} | ${after.toLocaleString()} | ${reduction}% |`);
}

// 1. Database query (Large JSON array)
const dbQuery = JSON.stringify(Array.from({ length: 500 }).map((_, i) => ({
  id: i,
  name: `User ${i}`,
  email: `user${i}@example.com`,
  role: "user",
  lastLogin: "2023-10-01T12:00:00Z",
  metadata: { "tenant": "default", "plan": "free", "status": "active" }
})), null, 2);

// 2. Codebase search (Repeated matches in few files)
const searchResult = Array.from({ length: 10 }).map((_, fileIdx) => {
  return Array.from({ length: 50 }).map((_, matchIdx) => 
`src/file_${fileIdx}.ts:${matchIdx}: import { auth } from 'lib/auth';
src/file_${fileIdx}.ts:${matchIdx + 1}: const user = auth.getUser();
src/file_${fileIdx}.ts:${matchIdx + 2}: if (!user) throw new Error('Unauth');`
  ).join('\n');
}).join('\n');

// 3. Server logs
const logs = Array.from({ length: 500 }).map((_, i) => 
  `[2023-10-01T12:${String(i%60).padStart(2, '0')}:00Z] INFO [src/server.ts] Request incoming GET /api/users UUID-${i}-ABCD`
).join('\n') + '\n[2023-10-01T12:30:00Z] ERROR [src/db.ts] Connection failed timeout';

// 4. Git diff (lots of context lines)
const diff = `diff --git a/src/main.ts b/src/main.ts
index e69de29..d95f3ad 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -10,100 +10,100 @@
` + Array.from({length: 100}).map((_, i) => ` const unchanged_${i} = true;`).join('\n') + `
-const old = true;
+const old = false;
` + Array.from({length: 100}).map((_, i) => ` const unchanged_after_${i} = true;`).join('\n') + `
`.repeat(20);

// 5. Web page (HTML with lots of scripts/styles/attributes)
const html = `
<!DOCTYPE html>
<html>
<head>
  <style>${'.btn { color: red; } '.repeat(200)}</style>
  <script>${'console.log("tracking"); '.repeat(200)}</script>
</head>
<body>
  <div class="container" id="main" data-react-id="123" aria-label="main content">
    ${'<p>This is some meaningful article text that should be preserved. It contains information about the product.</p>'.repeat(50)}
  </div>
</body>
</html>
`;

// 6. Code / File contents (JSDoc and Comments to strip)
const codeFile = `
/**
 * This is a massive module-level JSDoc.
 * It goes on for many lines to explain the file architecture.
 ${' * And more documentation lines.\n'.repeat(50)}
 */
import { something } from 'somewhere';

/**
 * Function description.
 ${' * More parameter descriptions and fluff.\n'.repeat(50)}
 */
export function myFunc(a: string, b: number) {
  // Inline comment describing logic
  // Another inline comment
  console.log(a, b);
}
`.repeat(20);

// 7. Plain text / Prose (Semantic ML compression)
const plainText = `
We are thrilled to announce our new update today. The weather is beautiful outside and the birds are singing.
There are many things we could talk about, but we will focus on the core updates.
This section contains a lot of fluff that the ML model should ideally rank lower.
${'It is a sunny day and everyone is very happy to be working on this project. '.repeat(50)}
The core API endpoint has changed from v1 to v2 and now requires a Bearer token in the Authorization header.
${'More fluff text about our company culture and how much we love our users. '.repeat(50)}
If you do not update your API keys by tomorrow, your integration will break.
${'Thank you for being a valued customer. '.repeat(50)}
`.repeat(10);


console.log('| Tool output type | Before | After | Reduction |');
console.log('|------------------|--------|-------|-----------|');
measure('Database query', dbQuery, 'sql');
measure('Codebase search', searchResult, 'grep');
measure('Server logs', logs, 'tail');
measure('Git diff', diff, 'git_diff');
measure('Web page', html, 'curl');
measure('Code file', codeFile, 'cat');
measure('Plain text', plainText, 'read');
