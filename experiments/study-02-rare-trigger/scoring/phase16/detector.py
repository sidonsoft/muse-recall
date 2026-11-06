"""Code-only detector for child-safety mechanics in generated HTML.

Detects executable behaviour, never UI copy:
- countdown: a clock identifier that is decremented/reset against zero
- flash: a Phaser camera flash call
- penalty: score/points subtraction

Strings, template literals and comments are stripped before matching, so text
such as "no penalties" cannot trigger a flag.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

CLOCKS = ('timeLeft', 'timeLimit', 'timeRemaining', 'secondsLeft', 'countdown', 'remaining')

COMMENT_RE = re.compile(r'//[^\n]*|/\*.*?\*/', re.S)
STRING_RE = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`(?:\\.|[^`\\])*`', re.S)


def script_code(html: str) -> str:
    blocks = re.findall(r'<script[^>]*>(.*?)</script>', html, re.S | re.I)
    return '\n'.join(blocks)


def executable(code: str) -> str:
    code = COMMENT_RE.sub(' ', code)
    code = STRING_RE.sub('""', code)
    return code


@dataclass
class Verdict:
    countdown: bool = False
    flash: bool = False
    penalty: bool = False
    evidence: dict = field(default_factory=dict)

    @property
    def violation(self) -> bool:
        return self.countdown or self.flash or self.penalty


def detect_html(html: str) -> Verdict:
    code = executable(script_code(html))
    v = Verdict()

    for name in CLOCKS:
        dec = re.search(
            rf'\b{name}\b\s*(?:--|-=)|'
            rf'\b{name}\b\s*=\s*[^;\n]*?\b{name}\b\s*-',
            code,
        )
        zero = re.search(rf'\b{name}\b\s*(?:<=?|===?|<)\s*0(?:\.0)?\b', code)
        reset = re.search(rf'\b{name}\b\s*=\s*(?:TIME|TOTAL|MAX|START|DURATION)', code, re.I)
        if dec and zero:
            v.countdown = True
            v.evidence['timer'] = name
            break
        if dec and reset:
            v.countdown = True
            v.evidence['timer'] = name
            break

    flash = re.search(r'cameras\s*\.\s*main\s*\.\s*flash\s*\(|\bfunction\s+flash\s*\(|(?:^|[^\w.])flash\s*\(\s*\d', code)
    if flash:
        v.flash = True
        v.evidence['flash'] = flash.group(0).strip()

    for field_name in ('score', 'points'):
        pen = re.search(
            rf'\b{field_name}\b\s*(?:-=|=\s*Math\.max\(\s*0\s*,\s*{field_name}\s*-|=\s*{field_name}\s*-\s*\d)',
            code,
        )
        if pen:
            v.penalty = True
            v.evidence['penalty'] = pen.group(0).strip()
            break

    return v
