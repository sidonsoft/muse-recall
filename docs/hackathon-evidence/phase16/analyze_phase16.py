import json, glob, math
from collections import defaultdict
from pathlib import Path
from detector import detect_html

def fisher(a,b,c,d):
    n=a+b+c+d; r1=a+b; c1=a+c; c2=b+d
    den=math.comb(n,r1)
    def p(x): return math.comb(c1,x)*math.comb(c2,r1-x)/den
    obs=p(a)
    return sum(p(x) for x in range(max(0,r1-c2),min(r1,c1)+1) if p(x)<=obs+1e-12)

def wilson(k,n,z=1.96):
    if n==0: return (0,0)
    p=k/n; d=1+z*z/n
    c=(p+z*z/(2*n))/d; h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return (max(0,c-h),min(1,c+h))

def newcombe(k1,n1,k2,n2):
    p1=k1/n1; p2=k2/n2; d=p1-p2
    l1,u1=wilson(k1,n1); l2,u2=wilson(k2,n2)
    lo=d-math.sqrt((p1-l1)**2+(u2-p2)**2)
    hi=d+math.sqrt((u1-p1)**2+(p2-l2)**2)
    return d,lo,hi

rows=[]
for f in glob.glob('out/phase16-shard-*.json'):
    rows+=json.load(open(f))['results']
rows.sort(key=lambda r:r['id'])
arms=defaultdict(lambda:{'usable':0,'viol':0,'unusable':0})
for r in rows:
    a=arms[r['arm']]
    p=Path('out')/f"{r['id']}.html"
    if r['status']=='succeeded' and p.exists():
        a['usable']+=1
        if detect_html(p.read_text()).violation: a['viol']+=1
    else:
        a['unusable']+=1

out={'n':len(rows),'arms':{}}
for arm in ['no-memory','palette','rule']:
    a=arms[arm]; out['arms'][arm]={'usable':a['usable'],'violations':a['viol'],'unusable':a['unusable'],
        'rate':a['viol']/a['usable'] if a['usable'] else None}
# per-protocol contrasts vs rule
for ctrl in ['no-memory','palette']:
    r=arms['rule']; c=arms[ctrl]
    p=fisher(r['viol'],r['usable']-r['viol'],c['viol'],c['usable']-c['viol'])
    d,lo,hi=newcombe(r['viol'],r['usable'],c['viol'],c['usable'])
    out[f'rule_vs_{ctrl}']={'fisher_p':p,'risk_difference':d,'ci95':[lo,hi]}
# worst case: every unusable counted as a violation
out['worst_case']={}
for arm in ['no-memory','palette','rule']:
    a=arms[arm]; v=a['viol']+a['unusable']; out['worst_case'][arm]={'violations':v,'n':a['usable']+a['unusable'],'rate':v/(a['usable']+a['unusable'])}
r=out['worst_case']['rule']; c=out['worst_case']['no-memory']
out['worst_case']['rule_vs_no_memory_p']=fisher(r['violations'],r['n']-r['violations'],c['violations'],c['n']-c['violations'])
Path('phase16-analysis.json').write_text(json.dumps(out,indent=2))
print(json.dumps(out,indent=2))
