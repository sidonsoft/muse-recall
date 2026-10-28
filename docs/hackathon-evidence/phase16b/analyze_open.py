import json, glob, math
from collections import defaultdict
from pathlib import Path
import sys
sys.path.insert(0,'/Users/burnz/projects/muse-memory-lab/research/phase16')
from detector import detect_html

def fisher(a,b,c,d):
    n=a+b+c+d; r1=a+b; c1=a+c; c2=b+d; den=math.comb(n,r1)
    def p(x): return math.comb(c1,x)*math.comb(c2,r1-x)/den
    obs=p(a); return sum(p(x) for x in range(max(0,r1-c2),min(r1,c1)+1) if p(x)<=obs+1e-12)
def wilson(k,n,z=1.96):
    p=k/n; d=1+z*z/n; c=(p+z*z/(2*n))/d; h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return (max(0,c-h),min(1,c+h))
def newcombe(k1,n1,k2,n2):
    p1=k1/n1; p2=k2/n2; d=p1-p2; l1,u1=wilson(k1,n1); l2,u2=wilson(k2,n2)
    return d, d-math.sqrt((p1-l1)**2+(u2-p2)**2), d+math.sqrt((u1-p1)**2+(p2-l2)**2)

rows=[]
for f in glob.glob('out/baseten-shard-*.json'): rows+=json.load(open(f))['results']
by=defaultdict(lambda:{'usable':0,'viol':0})
for r in rows:
    p=Path('out')/f"{r['id']}.html"
    if r['status']=='succeeded' and p.exists():
        by[r['arm']]['usable']+=1
        if detect_html(p.read_text()).violation: by[r['arm']]['viol']+=1
out={'model':'meta-models/muse-spark-open-1026','n':len(rows),'arms':{}}
for arm in ['no-memory','palette','rule']:
    a=by[arm]; out['arms'][arm]={'usable':a['usable'],'violations':a['viol'],'rate':a['viol']/a['usable']}
for ctrl in ['no-memory','palette']:
    r=by['rule']; c=by[ctrl]
    p=fisher(r['viol'],r['usable']-r['viol'],c['viol'],c['usable']-c['viol'])
    d,lo,hi=newcombe(r['viol'],r['usable'],c['viol'],c['usable'])
    out[f'rule_vs_{ctrl}']={'fisher_p':p,'risk_difference':d,'ci95':[lo,hi]}
d,lo,hi=newcombe(by['palette']['viol'],by['palette']['usable'],by['no-memory']['viol'],by['no-memory']['usable'])
out['palette_vs_no_memory']={'fisher_p':fisher(by['palette']['viol'],by['palette']['usable']-by['palette']['viol'],by['no-memory']['viol'],by['no-memory']['usable']-by['no-memory']['viol']),'risk_difference':d,'ci95':[lo,hi]}
Path('phase16b-analysis.json').write_text(json.dumps(out,indent=2))
print(json.dumps(out,indent=2))
