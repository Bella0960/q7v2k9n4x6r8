/**
 * Assemble the approved 108145-byte Thin Shadow V5 original with ONLY two
 * resource references. Never start from the later V4 or experimental five-page UI.
 *
 * Usage:
 *   node scripts/build-atmosphere-v5-custom.mjs /path/to/薄影-V5-精密横滑交互预览.html
 * Output:
 *   theme-store/atmosphere-v5-preserved-custom-preview.html
 *
 * Fails closed: if the exact V5 source is unavailable, it does not create
 * a substitute page, alter the original, or overwrite the prior output.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const sourcePath=process.argv[2];
if(!sourcePath){
 console.error('Missing original V5 file. Refusing to use an earlier or rebuilt design.');
 process.exitCode=2;
}else{
 const original=await readFile(resolve(sourcePath));
 const raw=original.toString('utf8');
 const minimumMarkers=[
  'v5-horizontal-album',
  'v5-photo-track',
  '__atV5DemoAddImage',
  'id="page-profile"',
  'id="page-chat"',
  'class="hero-art"',
  'id="music-toggle"',
  'id="at-preview-sticker-pop"'
 ];
 if(original.byteLength!==108145 || minimumMarkers.some(m=>!raw.includes(m))){
  console.error('This is not the approved 108145-byte V5 source. No preview written.');
  process.exitCode=3;
 }else{
  const link='<link rel="stylesheet" href="./atmosphere-v5-custom.css?v=20261113v2">';
  const addon='<script defer src="./atmosphere-v5-custom.js?v=20261113v2"></script>';
  for(const closing of ['</head>','</body>'])
   assert.equal(raw.split(closing).length-1,1,'Expected unique '+closing);
  const result=raw.replace('</head>',link+'</head>').replace('</body>',addon+'</body>');
  const stripped=result.replace(link,'').replace(addon,'');
  assert.equal(stripped,raw,'Original V5 markup was changed!');
  const sha=s=>createHash('sha256').update(s).digest('hex');
  assert.equal(sha(stripped),sha(raw),'Original design checksum changed');
  const output=resolve('theme-store/atmosphere-v5-preserved-custom-preview.html');
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,result,'utf8');
  console.log(JSON.stringify({output,sourceBytes:original.byteLength,
   sha256:sha(raw),onlyAdditiveTags:true,features:'V5 unchanged + custom media extension'},null,2));
 }
}
