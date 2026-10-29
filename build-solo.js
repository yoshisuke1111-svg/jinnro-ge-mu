/* Build the install-free practice page. No external requests are required. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
let html=read('public/index.html');
const inline=s=>s.replace(/<\/script/gi,'<\\/script');
html=html.replace('<link rel="stylesheet" href="/style.css">','<style>'+read('public/style.css')+'</style>');
html=html.replace('<script src="/shared/rules.js" defer></script>','<script>'+inline(read('shared/rules.js'))+'</script>');
html=html.replace('<script src="/transport.js" defer></script>','<script>'+inline(read('shared/bots.js'))+'</script>\n<script>'+inline(read('public/local-transport.js'))+'</script>');
html=html.replace('<script src="/app.js" defer></script>','');
html=html.replace('</body>','<script>'+inline(read('public/app.js'))+'</script>\n</body>');
html=html.replace('<title>人狼ゲーム</title>','<title>人狼ゲーム — ひとり＋CPU練習</title>');
fs.writeFileSync(path.join(__dirname,'public/solo.html'),html);
console.log('Built public/solo.html: '+Buffer.byteLength(html)+' bytes');
