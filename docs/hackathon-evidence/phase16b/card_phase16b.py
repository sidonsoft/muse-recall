from PIL import Image, ImageDraw, ImageFont
W,H=1920,1080
BG=(10,12,15); TEXT=(242,237,227); MUTED=(178,172,160); DIM=(120,126,136)
ACC=(231,193,124); RED=(238,118,118); GREEN=(122,204,156); LINE=(48,52,60)
HEL='/System/Library/Fonts/HelveticaNeue.ttc'; MONO='/System/Library/Fonts/Menlo.ttc'
def F(s,b=False,m=False): return ImageFont.truetype(MONO if m else HEL,s,index=1 if b else 0)

im=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
d.text((80,50),'PHASE 16  ·  CHILD-SAFETY MEMORY TRIAL  ·  96 EDITS  ·  TWO MODELS',font=F(20,True),fill=DIM)
d.text((80,88),'Two models. The rule holds.',font=F(56,True),fill=TEXT)
d.text((80,158),'Same baseline, request, memory and detector. The open model is a replication.',font=F(26),fill=MUTED)

def panel(x,title,sub,rows):
    w=840; y=230
    d.rounded_rectangle((x,y,x+w,y+420),radius=16,fill=(18,22,29),outline=LINE,width=1)
    d.text((x+28,y+22),title,font=F(20,True),fill=ACC)
    d.text((x+28,y+52),sub,font=F(19),fill=DIM)
    by=y+112
    for i,(label,val,frac,col) in enumerate(rows):
        yy=by+i*90
        d.text((x+28,yy-26),label,font=F(22,True),fill=TEXT)
        d.rounded_rectangle((x+28,yy,x+28+520,yy+42),radius=8,fill=(24,28,36))
        if frac>0:
            d.rounded_rectangle((x+28,yy,x+28+int(520*frac),yy+42),radius=8,fill=(70,36,40) if col==RED else (30,58,44))
            d.rounded_rectangle((x+28,yy,x+28+int(520*frac),yy+42),radius=8,outline=col,width=2)
        d.text((x+580,yy+2),val,font=F(28,True),fill=col)

panel(80,'MUSE SPARK','16 edits per arm · pre-registered',[
    ('No memory','12 / 12',1.0,RED),('Palette-only','12 / 12',1.0,RED),('Safety rule','0 / 13',0.0,GREEN)])
panel(1000,'MUSE SPARK OPEN','16 edits per arm · pre-registered',[
    ('No memory','16 / 16',1.0,RED),('Palette-only','6 / 16',0.375,RED),('Safety rule','0 / 16',0.0,GREEN)])

d.text((80,690),'Across both models:  no memory 28/28  ·  palette-only 18/28  ·  rule 0/29',font=F(29,True),fill=TEXT)
d.text((80,736),'Spark p = 1.9 × 10⁻⁷   ·   Open p = 3.3 × 10⁻⁹   ·   Open rule vs palette p = .018',font=F(21,m=True),fill=ACC)
d.text((80,780),'Both models: only the rule arm reaches zero. Palette-only is inconsistent.',font=F(23),fill=MUTED)

d.rounded_rectangle((80,830,1840,1035),radius=14,fill=(17,21,28),outline=LINE,width=1)
d.text((108,850),'Unusable: Spark 11/48 · Open 0/48.  Spark worst case 3/16 vs 16/16, p = 3.2 × 10⁻⁶.',font=F(21),fill=MUTED)
d.text((108,892),'Spark: HTML Studio CLI path.  Open: Baseten chat-completion path.',font=F(21),fill=MUTED)
d.text((108,934),'Same prompt, baseline, memory and detector.  No general safety claim.',font=F(20),fill=MUTED)
im.save('/Users/burnz/projects/muse-memory-lab/video/v10/source/card-phase16b.png')
print('card')
