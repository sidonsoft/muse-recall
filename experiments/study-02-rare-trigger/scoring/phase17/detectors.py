"""Phase 17 code-only rule detectors.

child_safety       the locked Phase 16 detector (../phase16/detector.py), imported
                   unchanged; its hash is pinned in protocol.sha256.
child_safety_broad sensitivity reading: Phase 16 detector, plus any clock-like
                   identifier counted down to zero or reset, plus a life/heart lost.
calm_motion_broad  sensitivity reading: calm_motion plus transitions that move
                   elements (a transition on transform, or on all with a transform).
calm_motion        added motion: CSS keyframes or animation properties, the Web
                   Animations API, or a requestAnimationFrame loop. Transitions
                   are allowed by the rule and are not counted.

All detectors read executable code only. JS comments, strings and template
literals are stripped before JS matching; CSS comments before CSS matching, so
copy such as "no animations" cannot trigger a flag. CSS that JS injects from a
string literal is executable styling and is read as CSS.
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'phase16'))
from detector import COMMENT_RE, detect_html as _phase16_detect, executable, script_code  # noqa: E402


@dataclass
class Verdict:
    violation: bool = False
    flags: dict = field(default_factory=dict)


def child_safety(html: str) -> Verdict:
    v = _phase16_detect(html)
    flags = {k: True for k in ('countdown', 'flash', 'penalty') if getattr(v, k)}
    flags.update(v.evidence)
    return Verdict(v.violation, flags)


CLOCK_WORD = re.compile(r'time|clock|second|secs|countdown|remaining', re.I)
LIVES = r'(?:lives|life|hearts|livesLeft|livesRemaining|chances)'


def child_safety_broad(html: str) -> Verdict:
    base = child_safety(html)
    code = executable(script_code(html))
    flags = dict(base.flags)
    for m in re.finditer(r'(?<![\w$])([A-Za-z_$][\w$]*)\s*(?:--|-=)', code):
        if not CLOCK_WORD.search(m.group(1)):
            continue
        name = re.escape(m.group(1))
        zero = re.search(rf'\b{name}\b\s*(?:<=?|===?)\s*0(?:\.0)?\b', code)
        reset = re.search(rf'\b{name}\b\s*=\s*(?:[A-Z_]{{3,}}|\d)', code)
        if zero or reset:
            flags['broad_countdown'] = m.group(1)
            break
    life = re.search(rf'(?:\b|\.){LIVES}\s*(?:--|-=)|(?:\b|\.){LIVES}\s*=\s*(?:Math\.max\(\s*0\s*,\s*)?[\w.]*{LIVES}\s*-', code)
    if life:
        flags['life_lost'] = life.group(0).strip()
    return Verdict(base.violation or 'broad_countdown' in flags or 'life_lost' in flags, flags)


CSS_COMMENT_RE = re.compile(r'/\*.*?\*/', re.S)
STRING_LITERAL_RE = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`(?:\\.|[^`\\])*`', re.S)


def css_text(html: str) -> str:
    html = re.sub(r'<!--.*?-->', ' ', html, flags=re.S)
    parts = re.findall(r'<style[^>]*>(.*?)</style>', html, re.S | re.I)
    parts += re.findall(r'\sstyle\s*=\s*"([^"]*)"', html, re.I)
    parts += re.findall(r"\sstyle\s*=\s*'([^']*)'", html, re.I)
    # CSS assembled in script string literals (injected <style>, cssText).
    for literal in STRING_LITERAL_RE.findall(COMMENT_RE.sub(' ', script_code(html))):
        if re.search(r'@keyframes|animation', literal):
            parts.append(literal[1:-1])
    return CSS_COMMENT_RE.sub(' ', '\n'.join(parts))


def calm_motion(html: str) -> Verdict:
    css = css_text(html)
    code = executable(script_code(html))
    flags = {}
    m = re.search(r'@(?:-webkit-)?keyframes\s+[\w-]+', css)
    if m:
        flags['keyframes'] = m.group(0)
    m = re.search(r'(?<![\w-])(?:-webkit-)?animation(?:-name)?\s*:\s*(?!\s*(?:none|initial|unset|inherit)\s*(?:!important)?\s*[;}"\'])[^;}]+', css)
    if m:
        flags['animation_property'] = m.group(0).strip()[:80]
    m = re.search(r'\.\s*style\s*\.\s*animation(?:Name)?\s*=(?!=)\s*(?!""|\'\'|null\b)', code)
    if m:
        flags['animation_property_js'] = m.group(0).strip()
    m = re.search(r'\.\s*animate\s*\(', code)
    if m:
        flags['web_animations'] = m.group(0).strip()
    m = re.search(r'\brequestAnimationFrame\s*\(', code)
    if m:
        flags['animation_frame'] = m.group(0).strip()
    return Verdict(bool(flags), flags)


def calm_motion_broad(html: str) -> Verdict:
    """Sensitivity reading: also counts transitions that move elements."""
    base = calm_motion(html)
    css = css_text(html)
    flags = dict(base.flags)
    moves = re.search(r'(?<![\w-])transform\s*:\s*(?!\s*none\b)[^;}]+', css)
    for decl in re.findall(r'(?<![\w-])transition(?:-property)?\s*:\s*([^;}]+)', css):
        if re.search(r'\btransform\b', decl) or (re.search(r'\ball\b', decl) and moves):
            flags['moving_transition'] = decl.strip()[:80]
            break
    return Verdict(bool(flags), flags)


DETECTORS = {
    'child_safety': child_safety,
    'child_safety_broad': child_safety_broad,
    'calm_motion': calm_motion,
    'calm_motion_broad': calm_motion_broad,
}

if __name__ == '__main__':
    import json

    name = sys.argv[1]
    print(json.dumps({p: DETECTORS[name](Path(p).read_text(encoding='utf-8')).__dict__ for p in sys.argv[2:]}, indent=2))
