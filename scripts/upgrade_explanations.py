"""공식 제출문에 나온 형상·목적을 한국어로 정리한다. 성능 수치를 추정하지 않는다."""
import re

NAMES={'Front Wing':'프런트 윙','Rear Wing':'리어 윙','Beam Wing':'빔 윙','Front Wing Endplate':'프런트 윙 엔드플레이트','Floor':'플로어','Floor Body':'플로어 본체','Floor Furniture':'플로어 부속물','Floor Edge':'플로어 가장자리','Floor Board':'플로어 보드','Diffuser':'디퓨저','Nose':'노즈','Bodywork':'차체 외장','Coke/Engine Cover':'엔진 커버','Sidepod':'사이드포드','Sidepod Inlet':'사이드포드 흡입구','Cooling Louvres':'냉각 루버','Front Corner':'전륜 주변 부품','Rear Corner':'후륜 주변 부품','Front Suspension':'프런트 서스펜션','Rear Suspension':'리어 서스펜션','Tailpipe':'배기 파이프','Exhaust Tailpipe':'배기 파이프'}

def name(component):
    return next((value for key,value in NAMES.items() if key.lower()==component.lower()),component)

def explain_item(raw,published):
    geometry=raw.get('geometry','').lower()
    description=raw.get('description','').lower()
    reason=raw.get('reason','').lower()
    component=name(raw['component'])
    features=[]
    for token,label in [('endplate','엔드플레이트'),('diveplane','다이브플레인'),('dive plane','다이브플레인'),('footplate','윙 하단 풋플레이트'),('mainplane','주익'),('flap','플랩'),('leading edge','앞전'),('trailing edge','뒷전'),('fence','기류를 나누는 펜스'),('winglet','소형 윙렛'),('fairing','공기를 정돈하는 덮개'),('inlet','흡입구'),('outlet','배출구'),('exit','배출구'),('louvre','냉각 루버'),('undercut','사이드포드 하부 언더컷'),('keel','플로어 중앙부 킬'),('slot','슬롯'),('strake','기류 유도판'),('stay','지지대'),('pillar','지지 기둥'),('profile','단면'),('camber','곡률'),('incidence','설치각')]:
        if token in geometry and label not in features:features.append(label)
    if published['change']=='규정 대응':change=f'{component}의 형상을 새 규정에 맞춰 변경한 항목입니다.'
    elif published['change']=='신규 설계':change=f'{component}의 새 설계 또는 새 구성을 제출했습니다.'
    elif published['change']=='서킷 특화 사양':change=f'{component}에 이번 서킷의 조건에 맞춘 사양을 추가했습니다.'
    else:change=f'{component}의 기존 형상을 수정했습니다.'
    if features:change+=' 원본에 명시된 변경 부위는 '+ '·'.join(features[:4])+'입니다.'
    directions=[]
    for pattern,text in [
        (r'(?:narrower|reduced|shorter)\s+span','윙 폭을 줄이는 방향입니다.'),
        (r'(?:longer|increased)\s+chord','윙 시위 길이를 늘리는 방향입니다.'),
        (r'(?:increased|increas\w*|more)\s+camber|camber\s+increase','곡률을 늘리는 변경이 포함됩니다.'),
        (r'(?:smaller|reduced|reduces).{0,30}(?:exit|opening|outlet)','냉각 배출구 또는 개구 면적을 줄이는 변경이 포함됩니다.'),
        (r'(?:larger|enlarged|increased).{0,30}(?:exit|opening|outlet)','냉각 배출구 또는 개구 면적을 늘리는 변경이 포함됩니다.'),
    ]:
        if re.search(pattern,geometry):directions.append(text)
    change+=' '+ ' '.join(directions[:1]) if directions else ''
    aims=[]
    for token,text in [
        ('front wheel wake','앞 타이어 뒤에 생기는 흐트러진 공기 흐름 제어'),
        ('front tyre wake','앞 타이어 후류 제어'),
        ('rear tyre','뒤 타이어 주변 기류 관리'),
        ('diffuser','디퓨저로 전달되는 기류와 하부 공력 개선'),
        ('underfloor','차체 바닥 아래의 공기 흐름 개선'),
        ('floor','플로어에 들어가는 기류와 바닥 공력 개선'),
        ('rear wing','리어 윙과 주변 부품의 공력 상호작용 개선'),
        ('balance','앞뒤 공력 밸런스 조정 범위 확보'),
        ('stability','기류의 안정성 확보'),
        ('cooling','필요한 냉각 여유 확보'),
        ('reliab','신뢰성 확보'),
    ]:
        if token in description and text not in aims:aims.append(text)
    if not aims:
        for token,text in [('flow','공기를 의도한 방향으로 유도하는 기류 정돈'),('local load','해당 부위의 다운포스 확보'),('cooling','환경 조건에 맞는 냉각 범위 확보'),('drag range','서킷에 맞는 항력·다운포스 조합 확보'),('drag reduction','직선 구간의 공기저항 감소'),('structural','부품의 구조적 성능 개선'),('reliab','부품 신뢰성 확보')]:
            if token in reason:aims.append(text)
    effect=('팀 설명상 목표는 '+ '·'.join(aims[:2])+'입니다.') if aims else '원본에는 이 부품만의 작동 원리나 효과가 별도로 설명되지 않았습니다.'
    if 'efficiency' in description and 'expense' in description:
        effect+=' 냉각 또는 하중을 확보하는 대신 공력 효율을 일부 희생할 수 있다는 설명도 포함됩니다.'
    if raw.get('sharedFields'):
        effect+=' 여러 부품에 묶여 제출된 패키지 공통 설명입니다.'
    return {'changeExplanation':change,'effectExplanation':effect}

def team_summary(team,items):
    if not items:return None
    unique_parts=list(dict.fromkeys(name(item['component']) for item in items))
    parts='·'.join(unique_parts[:3])+(' 등' if len(unique_parts)>3 else '')
    purposes=list(dict.fromkeys(purpose for item in items for purpose in item['purpose'].split(' · ')))
    return f'{parts}의 {len(items)}개 변경으로 추구하는 목표는 '+ '·'.join(purposes[:3])+'입니다.'
