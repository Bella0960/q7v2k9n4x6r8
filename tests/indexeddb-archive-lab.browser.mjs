import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext();
 const page=await context.newPage();
 await page.route('http://localhost/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Archive Lab</title>'}));
 await page.goto('http://localhost/archive-lab');
 await page.addScriptTag({path:fileURLToPath(new URL('../shared/js/phone/storage/indexeddb-archive-lab.js',import.meta.url))});
 await page.addScriptTag({path:fileURLToPath(new URL('./fixtures/indexeddb-archive-lab-scenarios.js',import.meta.url))});
 page.on('console',msg=>console.log(msg.text()));
 const size=Number(process.env.MAO_ARCHIVE_TEST_ROWS||100000);
 if(![10000,100000,1000000].includes(size))throw new Error('Unsupported test size');
 const results=await page.evaluate(n=>runArchiveLabTests(x=>console.log(JSON.stringify(x)),n),size);
 console.log(JSON.stringify({passed:results.length,results}));
}finally{await browser.close()}
