const cache = new Map();
let revision = 0;
const labels = {'Front Wing':'프런트 윙','Rear Wing':'리어 윙','Beam Wing':'빔 윙','Front Wing Endplate':'프런트 윙 엔드플레이트','Floor':'플로어','Floor Body':'플로어 본체','Floor Furniture':'플로어 부속물','Floor Edge':'플로어 가장자리','Diffuser':'디퓨저','Nose':'노즈','Bodywork':'차체 외장','Coke/Engine Cover':'엔진 커버','Sidepod':'사이드포드','Sidepod Inlet':'사이드포드 흡입구','Cooling Louvres':'냉각 루버','Front Corner':'전륜 주변 부품','Rear Corner':'후륜 주변 부품','Front Suspension':'프런트 서스펜션','Rear Suspension':'리어 서스펜션','Tailpipe':'배기 파이프'};
function el(tag,text,cls) {
  const node=document.createElement(tag);
  if(text!=null)node.textContent=text;
  if(cls)node.className=cls;
  return node;
}
function link(source,page,text) {
  const url=new URL(source);
  if(url.protocol!=='https:'||url.hostname!=='www.fia.com')throw new Error('Invalid FIA source');
  if(page)url.hash=`page=${page}`;
  const node=el('a',text,'upgrade-source');
  node.href=url.href;node.target='_blank';node.rel='noopener';
  return node;
}
async function load(year) {
  if(!cache.has(year))cache.set(year,(async()=>{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch(`data/car-upgrades/${year}.json`,{cache:'no-cache',signal:controller.signal});
      if(!response.ok)throw new Error(`Car upgrades: ${response.status}`);
      return await response.json();
    }finally{clearTimeout(timer);}
  })());
  try{return await cache.get(year);}catch(error){cache.delete(year);throw error;}
}
export async function renderCarUpgrades(year,meeting) {
  const current=++revision;
  const host=document.getElementById('car-upgrade-list');
  const meta=document.getElementById('car-upgrade-meta');
  const select=document.getElementById('upgrade-team');
  const source=document.getElementById('car-upgrade-source');
  select.disabled=true;source.replaceChildren();host.replaceChildren();
  meta.textContent=`${meeting.name} · 자료를 불러오는 중…`;
  try {
    const dataset=await load(year);
    if(current!==revision)return;
    const entry=dataset.meetings.find(item=>item.key===meeting.key);
    if(!entry){
      meta.textContent=meeting.name;
      host.append(el('p','이 경기의 차량 업데이트 자료를 아직 확인하지 못했습니다.','muted'));
      return;
    }
    const teams=[...entry.teams].sort((a,b)=>b.items.length-a.items.length||a.team.localeCompare(b.team));
    const count=teams.reduce((n,team)=>n+team.items.length,0);
    const confirmed=teams.filter(team=>team.status!=='unavailable').length;
    meta.textContent=`${meeting.name} · ${count}건 · ${confirmed}/${teams.length}팀 자료 확인 · ${dataset.collected.slice(0,10)} 수집`;
    if(entry.source)source.append(link(entry.source,null,'FIA 원본 문서 ↗'));
    select.replaceChildren(el('option','전체 팀'));
    select.firstElementChild.value='';
    for(const team of teams){
      const option=el('option',`${team.team} · ${team.items.length}건`);
      option.value=team.team;select.append(option);
    }
    select.disabled=false;
    function render(){
      host.replaceChildren();
      const selected=select.value?teams.filter(team=>team.team===select.value):teams.filter(team=>team.items.length);
      selected.forEach((team,index)=>{
        const card=el('details',null,'team-upgrade');
        card.open=!!select.value||index===0;
        card.append(el('summary',`${team.team} · ${team.items.length}건`));
        if(!team.items.length)card.append(el('p',team.status==='none'?'이 경기에 업데이트를 제출하지 않았습니다.':'이 팀의 제출 자료를 아직 확인하지 못했습니다.','muted'));
        const list=el('ul');
        for(const item of team.items){
          const row=el('li');
          row.append(el('strong',labels[item.component]||item.component));
          if(labels[item.component])row.append(el('span',` ${item.component}`,'muted component-original'));
          row.append(el('p',[item.change,item.detail,`목적: ${item.purpose}`].filter(Boolean).join(' · ')));
          row.append(link(entry.source,item.page,`원본 ${item.page}쪽 ↗`));
          list.append(row);
        }
        card.append(list);host.append(card);
      });
      if(!select.value){
        const rest=teams.filter(team=>!team.items.length);
        if(rest.length){
          const detail=el('details',null,'no-updates');
          detail.append(el('summary',`그 외 ${rest.length}팀의 제출 상태`));
          const list=el('ul');
          for(const team of rest)list.append(el('li',`${team.team}: ${team.status==='none'?'업데이트 제출 없음':'자료 미확인'}`));
          detail.append(list);host.append(detail);
        }
      }
    }
    select.onchange=render;render();
  }catch(error){
    if(current!==revision)return;
    console.warn(error);meta.textContent=meeting.name;
    host.replaceChildren(el('p','차량 업데이트 자료를 불러오지 못했습니다. 랩타임 화면은 계속 사용할 수 있습니다.','muted'));
  }
}
