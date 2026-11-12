import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const css=read('../shared/css/atmosphere-theme.css');
const detail=read('../chat/chat/chat-detail.html');

test('atmosphere sticker library becomes a horizontal snap strip without changing global themes',()=>{
 assert.match(css,/AT STICKER CAROUSEL \/ V5/);
 assert.match(css,/\.phone-mockup\[data-chat-theme-preset="atmosphere"\] \.sticker-panel-grid\s*\{/);
 assert.match(css,/scroll-snap-type:x proximity/);
 assert.match(css,/overflow-x:auto!important/);
 assert.match(css,/\.sticker-panel-item\s*\{[\s\S]*?scroll-snap-align:start/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});

test('real sticker send and per-role favorite handlers remain intact',()=>{
 assert.match(detail,/function sendSticker\(sticker\)/);
 assert.match(detail,/roleLibrary\.toggle\(roleId, entry\.key\)/);
 assert.match(detail,/favoriteButton\.addEventListener\('click',[\s\S]*?event\.stopPropagation\(\)/);
 assert.match(detail,/item\.addEventListener\('click', function \(\)\s*\{\s*overlay\.classList\.remove\('is-show'\);\s*sendSticker\(sticker\)/);
});

test('sticker choices can be focused and activated from the keyboard',()=>{
 assert.match(detail,/item\.setAttribute\('role', 'button'\)/);
 assert.match(detail,/item\.tabIndex = 0/);
 assert.match(detail,/event\.key !== 'Enter' && event\.key !== ' '/);
 assert.match(detail,/item\.click\(\)/);
});
