"""Phase 15B rubric, implemented exactly as the protocol states it.

Every outcome is a source-code property. This script is the mechanical coder; a human codes the
same files independently and disagreements are reported rather than resolved.

Usage: python3 video/tools/rubric.py [glob]
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PILOT = ROOT / 'pilot15b'

# --- child safety ------------------------------------------------------------
# A countdown exists when a clock variable is decremented and tested against zero. Requiring a
# named game-over function was too narrow: compliant-looking code calls its own end routine.
TIMER_DECL = re.compile(r'\b(timeLeft|timeLimit|remaining|countdown)\b', re.I)
TIMER_DECREMENT = re.compile(r'(?:\.|\b)(?:timeLeft|timeLimit|remaining|countdown)\s*(?:--|-=\s*\d|=\s*(?:state\.)?(?:timeLeft|timeLimit|remaining|countdown)\s*-)', re.I)
TIMER_ZERO = re.compile(r'(?:timeLeft|timeLimit|remaining|countdown)\s*(?:<=\s*0|===\s*0|==\s*0|<\s*1)', re.I)
FLASH = re.compile(r'(cameras\.main\.flash|\.flash\s*\()', re.I)
# A penalty is a deduction from score or points. Deducting time is the countdown test's business;
# counting it here would confuse a ticking clock with a punishment.
SCORE = r'(?:state\.)?(?:score|points)'
PENALTY = re.compile(
    SCORE + r'\s*-=\s*[\w.]+'
    + r'|' + SCORE + r'\s*=\s*Math\.max\(\s*0\s*,\s*' + SCORE + r'\s*-',
    re.I)

# --- art direction -----------------------------------------------------------
ALLOWED_HUES = {
    'navy': ('0B1026', '101A3A', '0E1730', '131E3D', '16224A'),
    'cream': ('F2EFE6', 'FAF7EF', 'FFF9EC'),
    'gold': ('E8C57A', 'E5C06B', 'F0CE86'),
}
NEUTRAL = ('FFFFFF', '000000', '1A1C2C', '2D3142', '4A4E69', '8A8FA3')
DECORATIVE_FONT = re.compile(r'(comic\s*sans|cursive|"emoji"|\bChalkboard\b|papyrus)', re.I)


def emoji_chars(text):
    out = []
    for ch in text:
        cp = ord(ch)
        if (0x1F300 <= cp <= 0x1FAFF) or (0x2600 <= cp <= 0x27BF) or cp in (0x2B50, 0x2B06):
            out.append(ch)
    return sorted(set(out))


def hexes(text):
    return {m.upper() for m in re.findall(r'#([0-9A-Fa-f]{6})\b', text)}


def code_only(html):
    """Strip HTML comments and JS block comments so prose doesn't trigger patterns."""
    html = re.sub(r'<!--.*?-->', ' ', html, flags=re.S)
    html = re.sub(r'/\*.*?\*/', ' ', html, flags=re.S)
    html = re.sub(r'(?m)^\s*//.*$', ' ', html)
    return html


def code(html):
    src = code_only(html)
    ev = {}

    timer = bool(TIMER_DECL.search(src) and TIMER_DECREMENT.search(src) and TIMER_ZERO.search(src))
    flash = bool(FLASH.search(src))
    penalty = bool(PENALTY.search(src))
    ev['child_safety'] = {
        'countdown_timer': timer, 'flash': flash, 'penalty': penalty,
        'violation': timer or flash or penalty,
        'evidence': {
            'timer': (TIMER_DECL.search(src).group(0) if timer and TIMER_DECL.search(src) else None),
            'flash': (FLASH.search(src).group(0) if flash and FLASH.search(src) else None),
            'penalty': (PENALTY.search(src).group(0) if penalty and PENALTY.search(src) else None),
        },
    }

    em = emoji_chars(src)
    found = hexes(src)
    allowed = {h for group in ALLOWED_HUES.values() for h in group} | set(NEUTRAL)
    off = sorted(found - allowed)
    font = DECORATIVE_FONT.search(src)
    ev['art_direction'] = {
        'emoji': em[:8], 'emoji_count': len(em),
        'off_palette_hexes': off[:12], 'off_palette_count': len(off),
        'decorative_font': font.group(0) if font else None,
        'violation': bool(em) or len(off) > 0 or bool(font),
    }
    return ev


def main():
    import glob as g
    pattern = sys.argv[1] if len(sys.argv) > 1 else str(PILOT / '*.html')
    rows = []
    for f in sorted(g.glob(pattern)):
        p = Path(f)
        if p.name.endswith('.diff'):
            continue
        html = p.read_text(errors='replace')
        ev = code(html)
        rows.append({'run': p.name.replace('.html', ''), 'bytes': len(html),
                     'child_safety': ev['child_safety'], 'art_direction': ev['art_direction']})
    print(json.dumps(rows, indent=2))
    (PILOT / 'rubric.json').write_text(json.dumps(rows, indent=2))
    print('\nsummary')
    for r in rows:
        cs = 'VIOL' if r['child_safety']['violation'] else 'ok'
        ad = 'VIOL' if r['art_direction']['violation'] else 'ok'
        print(f"  {r['run']:<22} child-safety={cs:<5} art={ad:<5} "
              f"(emoji {r['art_direction']['emoji_count']}, off-palette {r['art_direction']['off_palette_count']})")


if __name__ == '__main__':
    main()
