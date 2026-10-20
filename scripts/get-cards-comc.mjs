// COMC verification pass helper (uncommitted). Low-volume, human-approved reference use.
// Only /Players/ and /Cards/ pages. >=3s between requests, all responses cached under temp/comc/cache/.
// Usage: node scripts/get-cards-comc.mjs fetch <relative-path-or-url> -> prints cache file
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const CACHE='temp/comc/cache';
const LOG='temp/comc/requests.log';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
let last=0;
export function cachePath(url){return path.join(CACHE,url.replace(/^https:\/\/www\.comc\.com/,'').replace(/[^A-Za-z0-9._,-]+/g,'_').slice(0,180)+'.html');}
export async function get(url){
  if(!/^https:\/\/www\.comc\.com\/(Players|Cards)\//.test(url)) throw new Error('refusing non Players/Cards url '+url);
  const f=cachePath(url);
  if(fs.existsSync(f)&&!fs.existsSync(f+'.status')==false){}
  if(fs.existsSync(f+'.status')) return {file:f,status:+fs.readFileSync(f+'.status','utf8'),cached:true};
  const wait=3200-(Date.now()-last); if(wait>0) await new Promise(r=>setTimeout(r,wait));
  last=Date.now();
  fs.mkdirSync(CACHE,{recursive:true});
  const out=execFileSync('curl',['-sL','-A',UA,'-o',f,'-w','%{http_code}',url],{encoding:'utf8'});
  fs.writeFileSync(f+'.status',out.trim());
  fs.appendFileSync(LOG,new Date().toISOString()+' '+out.trim()+' '+url+'\n');
  return {file:f,status:+out.trim(),cached:false};
}
export function parseCards(html){
  const rows=[];
  const parts=html.split('<div class="cardInfoWrapper">').slice(1);
  for(const p of parts){
    const cls=(p.match(/class="cardinfo searchresult([^"]*)"/)||[])[1]||'';
    const desc=((p.match(/<div class="description">\s*([\s\S]*?)\s*<\/div>/)||[])[1]||'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").trim();
    const href=(p.match(/<h3 class="title">\s*<a[^>]*href="([^"]+)"/)||[])[1]||'';
    const title=((p.match(/<h3 class="title">\s*<a[^>]*>([^<]*)</)||[])[1]||'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").trim();
    const m=desc.match(/^(\d{4}(?:-\d{2})?)\s+(.*?)\s+#([^\s]+)$/);
    rows.push({desc,season:m?m[1]:null,set:m?m[2]:desc,cardNumber:m?m[3]:null,title,flags:cls.trim().split(/\s+/).filter(Boolean),comcUrl:href?'https://www.comc.com'+href:null});
  }
  return rows;
}
if((process.argv[1]||'').endsWith('get-cards-comc.mjs')&&process.argv[2]==='fetch'){
  const u=process.argv[3].startsWith('http')?process.argv[3]:'https://www.comc.com'+process.argv[3];
  console.log(JSON.stringify(await get(u)));
}
