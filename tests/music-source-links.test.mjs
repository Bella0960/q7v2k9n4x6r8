import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../music/music.html',import.meta.url),'utf8');
const body=html.match(/function parseMusicSourceLink\(value\) \{[\s\S]*?\n  \}\n  function openMusicSource/);
assert.ok(body,'official link parser exists');
const parse=new Function(body[0].slice(0,-'function openMusicSource'.length)+';return parseMusicSourceLink;')();
test('official full song and playlist URLs canonicalize to external-only',()=>{
  for(const [url,provider,kind,id] of [
    ['https://music.163.com/#/song?id=123&userid=99','netease','song','123'],
    ['https://music.163.com/playlist?id=123','netease','playlist','123'],
    ['https://y.music.163.com/m/song?id=5','netease','song','5'],
    ['https://y.qq.com/n/ryqq/songDetail/AB123','qq','song','AB123'],
    ['https://i2.y.qq.com/a/song/AB123','qq','song','AB123'],
    ['https://y.qq.com/n/ryqq/playlist/123','qq','playlist','123']
  ]){
    const x=parse(url);assert.deepEqual([x.provider,x.kind,x.id,x.playback],[provider,kind,id,'external']);
    assert.ok(!x.url.includes('userid'));
  }
});
test('reject spoofing, ambiguous ids, arbitrary URLs and malformed fragments',()=>{
  for(const url of ['javascript:alert(1)','http://music.163.com/song?id=1','https://music.163.com.evil.test/song?id=1','https://music.163.com@evil.test/song?id=1','https://a@music.163.com/song?id=1','https://music.163.com:444/song?id=1','https://music.163.com/song?id=1&id=2','https://music.163.com/song?id=0','https://music.163.com/redirect?id=1','https://music.163.com/?id=1#/song?id=1','https://y.qq.com/n/ryqq/songDetail/%2f','https://y.qq.com\\@evil.test/n/ryqq/songDetail/1','https://y.qq.com/n/ryqq/songDetail/1\nfoo','https://music.163.com/#//[','https://music.163.com/#//evil.test/song?id=1'])assert.equal(parse(url),null,url);
});
test('source form remains independent of local import and opens only normalized official URL',()=>{
  assert.match(html,/id="musicSourceForm" onsubmit="return openMusicSource\(event\)"/);
  assert.match(html,/link\.href = source\.url/);
  assert.match(html,/link\.rel = 'noopener noreferrer'/);
  assert.match(html,/document\.getElementById\('musicImport'\)\.click\(\)/);
  assert.match(html,/不导入音频、不支持群内同步/);
});