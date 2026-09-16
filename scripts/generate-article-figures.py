"""Generate article figures locally. Requires Python matplotlib and Node.js.
Run from repository root: python3 scripts/generate-article-figures.py
Reuses runBacktest(quiet=True); does not request prices or place transactions.
"""
import json
import csv
import subprocess
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import FancyBboxPatch

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/images'
OUT.mkdir(exist_ok=True)
font = Path('/home/user/.fonts/NotoSansCJKkr-Regular.otf')
if font.exists():
    font_manager.fontManager.addfont(str(font))
plt.rcParams.update({'font.family': 'Noto Sans CJK KR', 'font.size': 12,
                     'axes.unicode_minus': False, 'svg.fonttype': 'path'})
navy, blue, cyan, pale, gray = '#02122F', '#0A61E7', '#129AF0', '#E6F1FD', '#51627B'
js = '''import {runBacktest} from './src/backtest.js';
console.log(JSON.stringify([30,10].map(bpSpreadBps=>({spread:bpSpreadBps,...runBacktest({bpSpreadBps,quiet:true})}))));'''
data = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', js], cwd=ROOT))
rows = data[0]['rows']
assert len(rows) == 13142
with (ROOT / 'data/backtest.SPCX.US.external.csv').open() as f:
    stored = list(csv.DictReader(f))
assert len(stored) == len(rows)
for actual, expected in zip(rows, stored):
    assert actual['iso'] == expected['iso']
    for key in ('rawA', 'rawB', 'costA', 'costB', 'delayA', 'delayB'):
        assert abs(actual[key] - float(expected[key])) < 0.000051
assert [sum(r['cost'+d] >= 20 for r in rows) for d in 'AB'] == [145,42]
assert [sum(r['cost'+d] >= 20 and r['delay'+d] > 0 for r in rows) for d in 'AB'] == [118,17]

def canvas(title, subtitle, number):
    fig = plt.figure(figsize=(16,9), facecolor='white')
    fig.text(.055,.925,title,fontsize=25,weight='bold',color=navy)
    fig.text(.055,.878,subtitle,fontsize=12,color=gray)
    fig.text(.947,.928,number,ha='right',fontsize=15,color=blue)
    return fig

def save(fig, name, notes):
    fig.text(.055,.068,notes,fontsize=10,color=gray,linespacing=1.7,va='top')
    for ext in ('png','svg'):
        fig.savefig(OUT / f'{name}.{ext}',dpi=160,facecolor='white')
    plt.close(fig)

def box(ax,x,y,w,h,title,sub):
    ax.add_patch(FancyBboxPatch((x,y),w,h,boxstyle='round,pad=0.012,rounding_size=0.018',facecolor=pale,edgecolor='none'))
    ax.text(x+w/2,y+h*.64,title,ha='center',va='center',fontsize=16,weight='bold',color=navy)
    ax.text(x+w/2,y+h*.29,sub,ha='center',va='center',fontsize=11,color=gray)

def arrow(ax,a,b,color=blue):
    ax.annotate('',xy=b,xytext=a,arrowprops={'arrowstyle':'-|>','lw':2.4,'color':color,'mutation_scale':17})

fig=canvas('같은 SPCX 토큰이 두 시장을 연결한다','SPCX 소액 왕복 실험 · 2026.09.09 · 매수 → 전송·입금 → 매도', '01')
ax=fig.add_axes([.055,.16,.89,.65]); ax.set(xlim=(0,1),ylim=(0,1)); ax.axis('off')
box(ax,.015,.40,.23,.24,'Solana DEX','Jupiter 집계 견적\nRaydium · Meteora 등 개별 풀')
box(ax,.32,.40,.16,.24,'개인 지갑','같은 민트의 SPCX')
box(ax,.65,.40,.32,.24,'Backpack 계정','입금주소 → 브로커리지 계좌')
arrow(ax,(.245,.55),(.315,.55)); arrow(ax,(.315,.47),(.245,.47))
ax.text(.28,.69,'매수 / 매도',ha='center',fontsize=11,color=gray)
arrow(ax,(.485,.59),(.645,.59))
ax.text(.562,.73,'입금 반영 100초',ha='center',weight='bold',color=blue,fontsize=14)
ax.text(.562,.675,'온체인 확정 후 · 입금 수수료 무료',ha='center',fontsize=10,color=gray)
arrow(ax,(.645,.445),(.485,.445),cyan)
ax.text(.56,.34,'출금 도착 11초',ha='center',weight='bold',color=blue,fontsize=14)
ax.text(.56,.28,'요청 후 · 수수료 0.004주',ha='center',fontsize=11,color=gray)
box(ax,.66,.02,.145,.19,'RFQ','브로커 견적')
box(ax,.83,.02,.145,.19,'자체 호가창','사용자 주문')
arrow(ax,(.755,.395),(.73,.22)); arrow(ax,(.875,.395),(.90,.22))
ax.text(.81,.91,'거래 가격은 RFQ와 호가창을 구분',ha='center',fontsize=13,color=navy)
ax.text(.015,.15,'A  DEX 매수 → 입금 → Backpack 매도',color=blue,fontsize=13,weight='bold')
ax.text(.015,.065,'B  Backpack 매수 → 출금 → DEX 매도',color=navy,fontsize=13,weight='bold')
save(fig,'trading-route','출처: 팀 제작 · docs/research-article.md 및 data/exec.jsonl (2026.09.09). SPCX 입금·출금 각 1회 실측.\n네트워크 비용은 백테스트에서 트랜잭션당 0.05달러로 가정하며, 위 출금 수수료와 별도다.')

fig=canvas('비용과 지연을 반영하면 기회는 얼마나 남을까?','SPCX 백테스트 모의 결과 · 동일한 5분 구간 13,142개 · 막대는 전체 표본 대비 비율', '02')
labels=['단순 가격 차이 > 0','비용 반영 수익률 > 0','비용 반영 수익률 ≥ 20 bps','위 신호 중 5분 뒤 모의 수익 > 0']
stats={}
for idx,d in enumerate('AB'):
    ax=fig.add_axes([.265,.52-idx*.345,.66,.245])
    for j,result in enumerate(data):
        rr=result['rows']; sig=[r for r in rr if r['cost'+d]>=20]
        counts=[sum(r['raw'+d]>0 for r in rr),sum(r['cost'+d]>0 for r in rr),len(sig),sum(r['delay'+d]>0 for r in sig)]
        stats[f'{d}_{result["spread"]}']=counts
        ys=[3-i+(.17 if j==0 else -.17) for i in range(4)]
        vals=[100*n/len(rr) for n in counts]
        ax.barh(ys,vals,height=.28,color=blue if j==0 else cyan,label=f'브로커 스프레드 {result["spread"]} bps')
        for y,v,n in zip(ys,vals,counts): ax.text(v+.6,y,f'{n:,}개 ({v:.2f}%)',va='center',fontsize=10,color=navy)
    ax.set(yticks=[3,2,1,0],yticklabels=labels,xlim=(0,73),xticks=[0,20,40,60])
    ax.tick_params(axis='both',length=0,labelcolor=gray)
    ax.set_xticklabels(['0%','20%','40%','60%'])
    ax.grid(axis='x',alpha=.15);ax.set_axisbelow(True)
    for spine in ax.spines.values(): spine.set_visible(False)
    ax.set_title(('A  DEX → Backpack' if d=='A' else 'B  Backpack → DEX'),loc='left',pad=16,color=navy,weight='bold',fontsize=15)
    if idx==0: ax.legend(loc='lower right',bbox_to_anchor=(1,1.1),frameon=False,ncol=2,fontsize=10)
save(fig,'backtest-funnel','출처: data/hist/ 원천 캔들 · src/backtest.js 재계산 (2026.06.12–09.09). 1주, DEX 스프레드 2 bps, 출금 0.004주, TX당 $0.05.\n5분 뒤 가격이 없으면 현재 가격을 쓰는 기존 모델을 재현했다. 연속 신호는 중복될 수 있으며 실제 체결·확정 수익을 뜻하지 않는다.')

fig=canvas('신호는 언제 관측됐을까?','DEX → Backpack · 비용 반영 수익률 ≥ 20 bps · 브로커 스프레드 30 bps · 백테스트 모의 결과', '03')
groups=[[(f'{m}월' + (' (9일까지)' if m==9 else ''),[r for r in rows if int(r['iso'][5:7])==m]) for m in (6,7,8,9)],
        [(label,[r for r in rows if r['session']==key]) for key,label in [('OVERNIGHT','오버나이트'),('PRE','프리마켓'),('REGULAR','정규장'),('POST','애프터'),('WEEKEND','주말')]]]
for i,group in enumerate(groups):
    ax=fig.add_axes([.075+i*.48,.25,.39,.50])
    nums=[sum(r['costA']>=20 for r in rr) for _,rr in group]
    rates=[100*n/len(rr) if rr else 0 for n,(_,rr) in zip(nums,group)]
    ax.bar(range(len(group)),rates,color=[blue if v==max(rates) else cyan for v in rates],width=.56)
    for x,((label,rr),n,v) in enumerate(zip(group,nums,rates)):
        ax.text(x,v+.14,f'{v:.2f}%\n{n:,} / {len(rr):,}' if rr else '표본 없음',ha='center',va='bottom',color=navy,fontsize=12)
    ax.set(xticks=range(len(group)),xticklabels=[x[0] for x in group],ylim=(0,5.5),yticks=range(6))
    ax.set_yticklabels([f'{v}%' for v in range(6)])
    ax.tick_params(length=0,labelcolor=gray,labelsize=11)
    ax.grid(axis='y',alpha=.15); ax.set_axisbelow(True)
    for spine in ax.spines.values(): spine.set_visible(False)
    ax.set_title('월별 신호 비율' if i==0 else '거래 시간대별 신호 비율',loc='left',pad=26,color=navy,fontsize=17,weight='bold')
    if i==0: assert nums==[80,15,45,5]
fig.text(.075,.155,'막대: 신호 수 ÷ 해당 그룹 표본 수    |    숫자: 신호 수 / 표본 수',color=gray,fontsize=12)
save(fig,'signal-distribution','출처: data/backtest.SPCX.US.external.csv와 일치하는 src/backtest.js 재계산 · 2026.06.12–09.09 · 총 145 / 13,142개.\n시간대는 기존 코드의 미국 동부 시간 분류(휴장일 별도 분류 없음). 표본이 없는 주말의 신호 비율은 산출하지 않는다.')
# Preserve exact plotted values for reviewers and subsequent updates.
(OUT/'figure-data.json').write_text(json.dumps({'sample_count':len(rows),'stages':stats,'distribution':[[{'label':label,'samples':len(rr),'signals':sum(r['costA']>=20 for r in rr)} for label,rr in group] for group in groups]},ensure_ascii=False,indent=2)+'\n')
print('Generated 3 figures as PNG + SVG, and figure-data.json')
