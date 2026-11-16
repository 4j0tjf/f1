// FIA 공식 경기 페이지에서 실제 PDF 링크를 찾아 내려받는다. 원본은 tmp/에 보관한다.
// node scripts/fetch-car-upgrades.mjs --year 2026
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const year=Number(args[args.indexOf('--year')+1]||new Date().getUTCFullYear());
if(!Number.isInteger(year)||year<2023||year>2100)throw new Error('Invalid year');
const index=JSON.parse(await readFile(path.join(root,`data/${year}/index.json`),'utf8'));
const dir=path.join(root,`tmp/fia/${year}`);
await mkdir(dir,{recursive:true});
const manifest={year,collected:new Date().toISOString(),meetings:[]};
for(const meeting of index.meetings.filter(m=>/Grand Prix/.test(m.name)&&m.sessions.some(s=>s.laps))){
  const name=meeting.name==='Barcelona Grand Prix'?'Barcelona-Catalunya Grand Prix':meeting.name;
  const page=`https://www.fia.com/documents/event/${encodeURIComponent(name)}`;
  const entry={key:meeting.key,name:meeting.name,page,status:'unavailable'};
  try{
    const response=await fetch(page,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`event HTTP ${response.status}`);
    const html=await response.text();
    const links=[...html.matchAll(/href="([^"]*car_presentation[^\"]*\.pdf)"/gi)].map(m=>m[1].replaceAll('&amp;','&'));
    const link=links.find(link=>link.includes(`/${year}_`));
    if(!link)throw new Error('No matching FIA PDF');
    entry.source=new URL(link,'https://www.fia.com').href;
    const pdf=await fetch(entry.source,{signal:AbortSignal.timeout(30000)});
    if(!pdf.ok)throw new Error(`PDF HTTP ${pdf.status}`);
    const bytes=Buffer.from(await pdf.arrayBuffer());
    if(bytes.subarray(0,4).toString()!=='%PDF')throw new Error('Not a PDF');
    entry.file=`tmp/fia/${year}/${meeting.key}.pdf`;
    await writeFile(path.join(root,entry.file),bytes);
    entry.status='downloaded';
  }catch(error){entry.error=error.message;}
  manifest.meetings.push(entry);
  console.log(`${entry.key} ${entry.name}: ${entry.status}${entry.error?' - '+entry.error:''}`);
}
await writeFile(path.join(dir,'sources.json'),JSON.stringify(manifest,null,2)+'\n');
