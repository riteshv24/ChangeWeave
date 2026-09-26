const base = process.env.CHANGEWEAVE_URL || 'http://127.0.0.1:4311';
async function request(path, body) {
  const response = await fetch(base + path, body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : undefined);
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${result.error || 'Request failed'}`);
  return result;
}
try {
  const workspace = await request('/api/demo');
  const recipeId = 'rename-price';
  const analysis = await request('/api/analyze', {workspace, recipeId});
  const run = await request('/api/migrate', {workspace, recipeId, expectedFingerprint: analysis.fingerprint});
  console.log(JSON.stringify({runId: run.id, status: run.status, patches: run.patches.map(p => `${p.repository}/${p.file}`), unresolved: run.unresolved, verification: run.verification, patchUrl: `${base}/api/runs/${run.id}/patches`}, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
