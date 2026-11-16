"""FIA PDF의 표를 읽어 부품과 제출 목적을 정리한다. pdfplumber가 필요하다.
python scripts/extract-car-upgrades.py 2026
"""
import json, re, sys
from pathlib import Path
import pdfplumber
from upgrade_explanations import explain_item, team_summary

ROOT = Path(__file__).resolve().parents[1]
year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
cache = ROOT / f'tmp/fia/{year}'
manifest = json.loads((cache/'sources.json').read_text(encoding='utf-8'))
editorial_file=ROOT/f'data/car-upgrades/editorial-{year}.json'
editorial=json.loads(editorial_file.read_text(encoding='utf-8')) if editorial_file.exists() else {}
aliases = [
    ('McLaren','McLaren'),('Mercedes','Mercedes'),('Red Bull Racing','Red Bull Racing'),
    ('Ferrari','Ferrari'),('Williams','Williams'),('Racing Bulls','Racing Bulls'),
    ('Aston Martin','Aston Martin'),('Haas','Haas F1 Team'),('Audi','Audi'),
    ('Alpine','Alpine'),('Cadillac','Cadillac'),
]
def clean(text): return re.sub(r'\s+',' ', text or '').strip()

output = {'year':year,'collected':manifest['collected'],'publisher':'FIA','meetings':[]}
raw_output=[]
for source in manifest['meetings']:
    entry={k:source[k] for k in ['key','name','page']}
    entry.update(source=source.get('source'),status='unavailable',teams=[])
    teams={team:{'team':team,'status':'unavailable','items':[]} for _,team in aliases}
    current=None
    if source['status']=='downloaded':
        with pdfplumber.open(ROOT/source['file']) as pdf:
            for page_num,page in enumerate(pdf.pages,1):
                text=page.extract_text() or ''
                header=text[:200]
                match=next((team for alias,team in aliases if re.search(re.escape(alias),header,re.I)),None)
                if match:current=teams[match]
                if not current or not text.strip():continue
                if re.search(r'no\s+(?:new\s+)?updates?',text,re.I):
                    current['status']='none'
                    current['page']=page_num
                for table in page.extract_tables():
                    if not table or len(table[0]) not in [5,7,13]:continue
                    if not any('Updated' in str(cell) for row in table[:2] for cell in row):continue
                    groups=[('component',1,4),('reason',4,7),('geometry',7,10),('description',10,13)] if len(table[0])==13 else [('component',1,2),('reason',2,3),('geometry',3,4),('description',4,len(table[0]))]
                    item=None
                    for row in table:
                        if row[0] and re.fullmatch(r'\d+',clean(row[0])):
                            previous_item=item
                            item={name:clean(' '.join(x for x in row[start:end] if x)) for name,start,end in groups}
                            shared=[]
                            for name,start,end in groups:
                                if name!='component' and previous_item and all(cell is None for cell in row[start:end]):
                                    item[name]=previous_item[name]
                                    shared.append(name)
                            if shared:item['sharedFields']=shared
                            item['page']=page_num
                            current['items'].append(item)
                            current['status']='reported'
                        elif item:
                            for name,start,end in groups:
                                more=clean(' '.join(x for x in row[start:end] if x))
                                if more:item[name]=clean(item[name]+' '+more)
        # 호주 Williams 표는 이미지라서 원본 10쪽을 직접 확인한 보완값을 사용한다.
        if source['key']==1279:
            teams['Williams']={'team':'Williams','status':'reported','items':[
                {'component':'Coke/Engine Cover','reason':'Circuit specific - Cooling Range','geometry':'Smaller engine cover exit area','description':'','page':10},
                {'component':'Front Wing Endplate','reason':'Performance - Flow Conditioning','geometry':'New front wing endplate dive plane geometry','description':'','page':10},
                {'component':'Floor','reason':'Performance - Local Load','geometry':'New floor winglet and cutout ahead of rear tyres','description':'','page':10},
                {'component':'Rear Wing','reason':'Performance - Flow Conditioning','geometry':'New optional winglets and rear wing pillar extensions','description':'','page':10}
            ]}
        for team in teams.values():
            team['items']=[item for item in team['items'] if item['component']]
        entry['status']='reviewed' if all(t['status']!='unavailable' for t in teams.values()) else 'partial'
    raw_output.append({**entry,'teams':list(teams.values())})
    # 표의 사실 항목만 공개한다. 긴 설명 원문은 복제하지 않고 원본 PDF로 연결한다.
    for team in teams.values():
        published={k:v for k,v in team.items() if k!='items'}
        published['items']=[]
        for item in team['items']:
            reason=item['reason'].lower()
            purposes=[]
            for text,label in [('flow','기류 정돈'),('local load','다운포스'),('balance range','밸런스 조정'),('cooling','냉각'),('drag range','항력 범위 조정'),('drag reduction','항력 감소'),('structural','구조 개선'),('reliab','신뢰성'),('weight','경량화'),('mechanical','기계적 성능')]:
                if text in reason:purposes.append(label)
            geometry=item['geometry'].lower()
            change='형상 수정'
            if re.search(r'\bnew\b',geometry):change='신규 설계'
            if 'regulation' in geometry:change='규정 대응'
            if 'circuit' in reason:change='서킷 특화 사양'
            facts=[]
            for text,label in [('camber','캠버 변경'),('endplate','엔드플레이트 변경'),('inlet','흡입구 변경'),('outlet','배출구 변경'),('louvre','루버 변경'),('slot','슬롯 변경'),('span','폭 변경'),('chord','시위 변경'),('height','높이 변경'),('incidence','설치각 변경'),('fence','펜스 변경'),('edge','가장자리 변경')]:
                if text in geometry:facts.append(label)
            result={'component':item['component'],'purpose':' · '.join(purposes) or '성능 개선',
                                       'change':change,'detail':' · '.join(facts[:3]),'page':item['page'],
                                       'sharedExplanation':bool(item.get('sharedFields'))}
            result.update(explain_item(item,result))
            result.update(editorial.get('itemOverrides',{}).get(f"{entry['key']}|{team['team']}|{item['component']}",{}))
            published['items'].append(result)
        published['technicalSummary']=team_summary(team['team'],published['items'])
        entry['teams'].append(published)
    entry['expertCommentaries']=editorial.get('experts',{}).get(str(entry['key']),[])
    output['meetings'].append(entry)
    print(source['key'],entry['status'],sum(len(t['items']) for t in entry['teams']),[t['team'] for t in entry['teams'] if t['status']=='unavailable'])
(cache/'extracted.json').write_text(json.dumps(raw_output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
dest=ROOT/f'data/car-upgrades/{year}.json'
dest.parent.mkdir(parents=True,exist_ok=True)
dest.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
