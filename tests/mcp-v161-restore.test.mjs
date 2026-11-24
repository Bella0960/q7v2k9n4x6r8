import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const page=readFileSync(new URL('../settings/mcp-connections.html',import.meta.url),'utf8');
const settings=readFileSync(new URL('../settings/settings.html',import.meta.url),'utf8');
const chat=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
test('v161 preserves the settings route and loads the adapter in dependency order without automatic tool dispatch',()=>{
 assert.ok(settings.includes("window.location.href='mcp-connections.html'"));
 const files=['mcp-client.js','mcp-role-permissions.js','mcp-ai-tools.js'];
 const indexes=files.map(f=>chat.indexOf(f));
 assert.ok(indexes[0]>=0&&indexes[0]<indexes[1]&&indexes[1]<indexes[2]);
 assert.ok(!chat.includes('MaoMcpAiTools.executeForRole('));
});
test('connect reads the typed token before disconnect and prevents late session resurrection',()=>{
 const s=page.slice(page.indexOf("$('connectBtn').addEventListener('click'"),page.indexOf("$('disconnectBtn').addEventListener('click'"));
 assert.ok(s.indexOf("var token = $('serverToken').value;")<s.indexOf('disconnect();'));
 assert.ok(s.includes('pendingClient = candidateClient;'));
 assert.equal(s.split('if (epoch !== connectionEpoch) return;').length-1,2);
 assert.ok(page.includes('if (pending && pending !== old) void pending.disconnect();'));
 assert.ok(page.includes("localStorage.getItem(STORE_KEY) !== raw"));
 assert.ok(page.includes("if (!safeWrite(saved.filter"));
});
