from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

W,H=1920,1080
BG=(10,12,15); TEXT=(242,237,227); MUTED=(160,168,180); DIM=(112,120,132)
ACC=(231,193,124); RED=(238,118,118); GREEN=(122,204,156); LINE=(44,48,56)
HEL='/System/Library/Fonts/HelveticaNeue.ttc'; MONO='/System/Library/Fonts/Menlo.ttc'
def F(s,b=False,mono=False,m=False): return ImageFont.truetype(MONO if m else HEL,s,index=1 if b else 0)

im=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
for x in range(0,W,80): d.line((x,0,x,H),fill=(255,255,255,5))
for y in range(0,H,80): d.line((0,y,W,y),fill=(255,255,255,5))

d.text((80,56),'PHASE 16  ·  CHILD-SAFETY MEMORY TRIAL  ·  48 EDITS',font=F(20,True),fill=DIM)
d.text((80,96),'The rule is the active ingredient.',font=F(58,True),fill=TEXT)
d.text((80,170),'Same game. Same request. Three memory conditions.',font=F(28),fill=MUTED)

rows=[('No memory','12 / 12',1.0,RED),('Palette-only memory','12 / 12',1.0,RED),('Safety rule remembered','0 / 13',0.0,GREEN)]
x0=80; y=270; bw=800; bh=64; gap=120
for i,(label,val,frac,col) in enumerate(rows):
    yy=y+i*gap
    d.text((x0,yy-44),label,font=F(28,True),fill=TEXT)
    d.rounded_rectangle((x0,yy,x0+bw,yy+bh),radius=10,fill=(24,28,36))
    if frac>0:
        d.rounded_rectangle((x0,yy,x0+int(bw*frac),yy+bh),radius=10,fill=(70,36,40) if col==RED else (30,58,44))
        d.rounded_rectangle((x0,yy,x0+int(bw*frac),yy+bh),radius=10,outline=col,width=2)
    d.text((x0+bw+40,yy+12),val,font=F(34,True),fill=col)

# axis
ax=y+3*gap+10
d.line((x0,ax,x0+bw,ax),fill=LINE,width=2)
for pct in (0,25,50,75,100):
    x=x0+int(bw*pct/100)
    d.text((x-10,ax+14),f'{pct}%',font=F(18),fill=DIM)

# stats panel
px=1080; py=250; pw=760
d.rounded_rectangle((px,py,px+pw,py+430),radius=16,fill=(18,22,29),outline=LINE,width=1)
d.text((px+32,py+28),'PRE-REGISTERED CONTRASTS',font=F(18,True),fill=DIM)
d.text((px+32,py+66),'Rule vs no memory',font=F(24,True),fill=TEXT)
d.text((px+32,py+100),'p = 1.9 × 10⁻⁷',font=F(30,True),fill=ACC)
d.text((px+32,py+144),'RD −100 pp  ·  95% CI −100 to −66.7',font=F(19,m=True),fill=MUTED)
d.text((px+32,py+196),'Rule vs palette-only',font=F(24,True),fill=TEXT)
d.text((px+32,py+230),'p = 1.9 × 10⁻⁷',font=F(30,True),fill=ACC)
d.text((px+32,py+274),'RD −100 pp  ·  95% CI −100 to −66.7',font=F(19,m=True),fill=MUTED)
d.text((px+32,py+330),'Holm α = .025 per contrast',font=F(20),fill=MUTED)
d.text((px+32,py+364),'Code-only detector, locked before the run',font=F(20),fill=MUTED)

d.text((80,880),'Per-protocol. Unusable runs 4 / 4 / 3 are reported, not dropped.',font=F(24),fill=MUTED)
d.text((80,920),'Worst case, counting every unusable run as a violation: 3/16 vs 16/16, p = 3.2 × 10⁻⁶.',font=F(24),fill=MUTED)
d.text((80,990),'One model · one baseline · one request · one edit path · no general safety claim',font=F(20),fill=DIM)
d.text((W-80,990),'PHASE 16  ·  48 RUNS',font=F(20,True),fill=DIM,anchor='ra')
im.save('/Users/burnz/projects/muse-memory-lab/video/v8/source/card-phase16.png')
print('card written')
