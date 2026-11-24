import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../library/library.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('  function validateBookText('),html.indexOf('  function normalizeZipPath('));
const ctx=vm.createContext({TextDecoder,Uint8Array});
vm.runInContext(source,ctx);
test('UTF-8 Chinese with chapters and indented paragraphs',()=>{
 const buf=new TextEncoder().encode('第一章 开始\n　　第一段。\n　　第二段。\n第二章 后续\n正文内容。');
 const b=ctx.parseTxtBook(ctx.decodeBookText(buf),'测试');
 assert.equal(b.chapters.length,2);assert.equal(b.chapters[0].paras.length,2);
 assert.equal(b.chapters[1].title,'后续');
});
test('UTF-16LE BOM supported',()=>{
 const buf=Buffer.concat([Buffer.from([255,254]),Buffer.from('Chapter 1\nHello','utf16le')]);
 assert.equal(ctx.decodeBookText(buf),'Chapter 1\nHello');
});
test('GB18030 Chinese decoded without replacement',()=>{
 assert.equal(ctx.decodeBookText(Uint8Array.from([0xd6,0xd0,0xce,0xc4])),'中文');
});
test('malformed BOM, binary and replacement character rejected',()=>{
 assert.throws(()=>ctx.decodeBookText(Uint8Array.from([0xef,0xbb,0xbf,0xff])));
 assert.throws(()=>ctx.decodeBookText(Uint8Array.from([0,1,2])));
 assert.throws(()=>ctx.parseTxtBook('bad \ufffd','bad'));
});
test('English wrapped lines preserve word boundary',()=>{
 assert.equal(ctx.parseTxtBook('Chapter 1\nhello\nworld','book').chapters[0].paras[0],'hello world');
});
