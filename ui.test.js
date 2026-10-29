'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/style.css'),'utf8');
const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const admin=fs.readFileSync(path.join(root,'public/admin.js'),'utf8');
const adminHtml=fs.readFileSync(path.join(root,'public/admin.html'),'utf8');

test('secret role card remains readable long enough',()=>{
  assert.match(app,/SECRET_ROLE_VISIBLE=10500/);
  assert.match(app,/SECRET_RESULT_VISIBLE=7200/);
  assert.match(app,/if\(secretFlipped\)\{closeSecret\(\);return;\}/);
});

test('mobile readability overrides are present',()=>{
  assert.equal(css.includes('\\n.secret-dialog'),false);
  assert.match(css,/@media\(max-width:700px\)[\s\S]*body\{font-size:16px/);
  assert.match(css,/\.mobile-nav button\{min-height:50px;font-size:14px\}/);
  assert.match(css,/\.board-bubble span\{font-size:12px/);
});

test('invite URL is rebuilt from the active room code',()=>{
  assert.match(app,/function inviteUrl\(\)/);
  assert.match(app,/url\.search='\?room='/);
});


test('custom room code creation is exposed in the online entry UI',()=>{
  assert.match(index,/id="customCode"/);
  assert.match(app,/roomCode:\$\('customCode'\)\.value\.trim\(\)/);
});

test('admin dashboard exposes server monitoring and CPU-only fast-forward controls',()=>{
  assert.match(adminHtml,/サーバー状態/);
  assert.match(adminHtml,/CPU観戦ラボ/);
  assert.match(admin,/create_cpu_watch/);
  assert.match(admin,/toggle_fast/);
  assert.match(admin,/CPU早送り ×8/);
});
