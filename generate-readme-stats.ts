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

console.log('| Tool output type | Before | After | Reduction |');
console.log('|------------------|--------|-------|-----------|');
measure('Database query', dbQuery, 'sql');
measure('Codebase search', searchResult, 'grep');
measure('Server logs', logs, 'tail');
measure('Git diff', diff, 'git_diff');
measure('Web page', html, 'curl');
