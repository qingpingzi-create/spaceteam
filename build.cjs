const fs = require('node:fs');
const path = require('node:path');
const base = __dirname;
const files = ['index.html', 'styles.css', 'app.js', 'scoring.js', 'cloud.js', 'favicon.svg'];
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const assets = Object.fromEntries(files.map(file => ['/' + file, [types[path.extname(file)], fs.readFileSync(path.join(base, 'dist', file), 'utf8')]]));
const scoring = fs.readFileSync(path.join(base, 'dist/scoring.js'), 'utf8');
const api = fs.readFileSync(path.join(base, 'server/api.mjs'), 'utf8').replace('export function createApi', 'function createApi');
const source = `const assets=${JSON.stringify(assets)};\nconst calculate=(()=>{const module={exports:{}};${scoring};return module.exports.calculate;})();\n${api}\nconst api=createApi(calculate);\nexport default { async fetch(request,env){const url=new URL(request.url);if(url.pathname.startsWith('/api/'))return api(request,env);if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});const asset=assets[url.pathname==='/'?'/index.html':url.pathname];if(!asset)return new Response('Not found',{status:404});return new Response(request.method==='HEAD'?null:asset[1],{headers:{'Content-Type':asset[0],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});}};\n`;
fs.mkdirSync(path.join(base, 'dist/server'), { recursive: true });
fs.writeFileSync(path.join(base, 'dist/server/index.js'), source);
if (fs.existsSync(path.join(base, '.openai/hosting.json'))) {
 fs.mkdirSync(path.join(base, 'dist/.openai'), { recursive: true });
 fs.copyFileSync(path.join(base, '.openai/hosting.json'), path.join(base, 'dist/.openai/hosting.json'));
}
console.log('Built dependency-free Worker with embedded game assets and leaderboard API.');
