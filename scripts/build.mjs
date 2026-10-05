import {build} from 'esbuild';
import {readFile,writeFile,readdir,mkdir,cp,rm} from 'node:fs/promises';
const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',webmanifest:'application/manifest+json',svg:'image/svg+xml',png:'image/png',txt:'text/plain; charset=utf-8',xml:'application/xml; charset=utf-8'};
const assets={};for(const name of await readdir('public')){const type=types[name.split('.').at(-1)];if(type){const binary=type==='image/png';assets['/'+name]={type,...(binary?{encoding:'base64'}:{}),content:await readFile('public/'+name,binary?'base64':'utf8')};}}
await writeFile('server/assets.generated.js','export default '+JSON.stringify(assets));
await rm('dist',{recursive:true,force:true});await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
await build({entryPoints:['server/index.js'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
await cp('.openai/hosting.json','dist/.openai/hosting.json');await cp('drizzle','dist/.openai/drizzle',{recursive:true});
console.log('Built portable Worker, embedded assets, and database migrations.');
