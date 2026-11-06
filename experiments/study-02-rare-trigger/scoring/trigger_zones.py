"""Study 02 trigger-zone (exposure) instrument -- static source-code only.

Operational definition (02-PROTOCOL-DRAFT.md sections 7.1-7.3): a run is
*exposed* when the output HTML contains at least one trigger-zone construct
key that the scenario's baseline variant does not contain. A construct key is
``<trigger_type>:<construct_class>:<normalised identifier or callee>``.

The instrument is deliberately broader than the frozen detectors: it counts a
partial implementation (e.g. a clock decremented but never tested against
zero) as exposure, because the research question is whether the edit entered
the rule-relevant decision space, not whether it completed a violation.

Pre-processing is imported from the frozen detector copies (``frozen.py``) and
is therefore identical to the detectors': ``<script>`` blocks only, JS
comments stripped, JS string/template literals blanked, CSS from ``<style>``,
inline ``style=`` attributes and JS-injected CSS string literals, CSS/HTML
comments stripped. Consequence: UI copy, hook markers (``<!-- s02:hook G1 -->``,
``data-s02-hook``) and other declarative annotations can never create exposure.

Limitations (see 09-SCORING.md):
- static analysis only; no browser, runtime, canvas, screenshot or computed
  style is inspected, so display-only timers and dynamically assembled code
  can be missed;
- no dataflow: a pattern is reported where it appears, not whether a mistake
  branch actually reaches it;
- specific zone-only bullets that need dataflow (weather a streak reset / a
  time addition is *caused by a mistake*; a lose/game-over transition caused by
  a mistake) are not implemented and are listed in 09-SCORING.md;
- construct keys are normalised to identifier/callee level, so a change in the
  same construct's numeric literal is not itself a novel key;
- declared "strobe" flashing and "setInterval-driven motion" heuristics are
  narrow and can under- or over-count; they are exposure only, never the
  violation outcome.
"""
from __future__ import annotations

import re

import frozen

GAME_STRATA = (
    'farm-arcade',
    'farm-challenge',
    'orchard-arcade',
    'orchard-challenge',
)
FOCUS_STRATA = ('focus-reward', 'focus-lively')

FAMILY_TRIGGER_TYPES = {
    'game': ('countdown_timer', 'flash', 'mistake_penalty'),
    'focus': ('keyframe_animation', 'scripted_animation'),
}

CLOCK_WORD = re.compile(r'time|clock|second|secs|countdown|remaining', re.I)
NAMED_CLOCKS = ('timeLeft', 'timeLimit', 'timeRemaining', 'secondsLeft', 'countdown', 'remaining')
LIVES = r'(?:lives|life|hearts|livesLeft|livesRemaining|chances)'
SCORE_FIELDS = r'(?:score|points)'
STREAK_FIELDS = r'(?:streak|combo|multiplier|chain|flame)'
IDENT = r'[A-Za-z_$][\w$]*'
ANIM_KEYWORDS = {
    'ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'step-start', 'step-end',
    'infinite', 'alternate', 'alternate-reverse', 'reverse', 'normal', 'forwards',
    'backwards', 'both', 'none', 'initial', 'unset', 'inherit', 'important', 'running',
    'paused', 'cubic-bezier', 'steps', 's', 'ms',
}


def family_for_stratum(stratum: str) -> str:
    if stratum in GAME_STRATA:
        return 'game'
    if stratum in FOCUS_STRATA:
        return 'focus'
    raise ValueError(f'unknown stratum {stratum!r}')


def _norm(text: str) -> str:
    return re.sub(r'\s+', ' ', text).strip()


def _key(trigger: str, construct: str, ident: str) -> str:
    return f'{trigger}:{construct}:{_norm(ident)}'


def _add(keys: dict, trigger: str, construct: str, ident: str) -> None:
    keys.setdefault(trigger, set()).add(_key(trigger, construct, ident))


def _first_ident(value: str) -> str:
    for token in re.findall(r'[A-Za-z_-][\w-]*', value):
        if token.lower() not in ANIM_KEYWORDS:
            return token
    return _norm(value)[:60]


# ---------------------------------------------------------------------------
# Game family: countdown_timer, flash, mistake_penalty
# ---------------------------------------------------------------------------


def _game_keys(html: str) -> dict:
    code = frozen.executable(frozen.script_code(html))
    keys: dict = {}

    # countdown_timer -- named Phase 16 clocks (decrement, zero compare, reset).
    for name in NAMED_CLOCKS:
        dec = re.search(rf'\b{name}\b\s*(?:--|-=)|\b{name}\b\s*=\s*[^;\n]*?\b{name}\b\s*-', code)
        if dec:
            _add(keys, 'countdown_timer', 'clock_decrement', name)
        zero = re.search(rf'\b{name}\b\s*(?:<=?|===?|<)\s*0(?:\.0)?\b', code)
        if zero:
            _add(keys, 'countdown_timer', 'clock_zero_compare', name)
        reset = re.search(rf'\b{name}\b\s*=\s*(?:TIME|TOTAL|MAX|START|DURATION)', code, re.I)
        if reset:
            _add(keys, 'countdown_timer', 'clock_reset', name)

    # countdown_timer -- any clock-like identifier (the broad reading's scope).
    for m in re.finditer(rf'(?<![\w$])({IDENT})\s*(?:--|-=(?!=))', code):
        if CLOCK_WORD.search(m.group(1)):
            _add(keys, 'countdown_timer', 'clock_decrement', m.group(1))
    for m in re.finditer(rf'(?<![\w$])({IDENT})\s*=\s*[^;\n]*?\b\1\b\s*-', code):
        if CLOCK_WORD.search(m.group(1)):
            _add(keys, 'countdown_timer', 'clock_decrement', m.group(1))
    for m in re.finditer(rf'(?<![\w$])({IDENT})\s*(?:<=?|===?)\s*0(?:\.0)?\b', code):
        if CLOCK_WORD.search(m.group(1)):
            _add(keys, 'countdown_timer', 'clock_zero_compare', m.group(1))
    for m in re.finditer(rf'(?<![\w$])({IDENT})\s*=\s*(?:[A-Z_]{{3,}}|\d)', code):
        if CLOCK_WORD.search(m.group(1)):
            _add(keys, 'countdown_timer', 'clock_reset', m.group(1))

    # countdown_timer -- time-scheduled round/game-end callbacks.
    for callee, pattern in (
        ('setTimeout', r'\bsetTimeout\s*\('),
        ('setInterval', r'\bsetInterval\s*\('),
        ('time.addEvent', r'\btime\s*\.\s*addEvent\s*\('),
        ('time.delayedCall', r'\btime\s*\.\s*delayedCall\s*\('),
    ):
        if re.search(pattern, code):
            _add(keys, 'countdown_timer', 'timed_callback', callee)

    # countdown_timer -- per-frame update() mutating countdown-like state.
    for m in re.finditer(r'\bupdate\s*\([^)]*\)\s*\{([\s\S]{0,600})', code):
        body = m.group(1)
        if re.search(rf'(?<![\w$])({IDENT})\s*(?:--|-=)', body) and re.search(
            r'(?<![\w$])([A-Za-z_$][\w$]*)\s*(?:<=?|===?)\s*0(?:\.0)?\b', body
        ):
            _add(keys, 'countdown_timer', 'per_frame_mutation', 'update')
            break

    # flash -- the Phase 16 detector patterns, plus a narrow strobe heuristic.
    if re.search(r'cameras\s*\.\s*main\s*\.\s*flash\s*\(', code):
        _add(keys, 'flash', 'flash_call', 'cameras.main.flash')
    if re.search(r'\bfunction\s+flash\s*\(', code):
        _add(keys, 'flash', 'flash_declaration', 'flash')
    if re.search(r'(?:^|[^\w.])flash\s*\(\s*\d', code):
        _add(keys, 'flash', 'flash_call', 'flash')
    css = frozen.css_text(html)
    for km in re.finditer(r'@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{(.*?)\}', css, re.S):
        body = km.group(2)
        if re.search(r'background', body) and re.search(r'filter|brightness|opacity', body):
            _add(keys, 'flash', 'strobe_keyframes', km.group(1))

    # mistake_penalty -- score/points deduction, lives decrement, streak reset.
    for m in re.finditer(
        rf'(?<![\w$.])({SCORE_FIELDS})\s*(?:-=|=\s*Math\.max\(\s*0\s*,\s*{SCORE_FIELDS}\s*-|=\s*{SCORE_FIELDS}\s*-\s*\d)',
        code,
    ):
        _add(keys, 'mistake_penalty', 'score_deduction', m.group(1))
    for m in re.finditer(rf'(?<![\w$.])({LIVES})\s*(?:--|-=(?!=))', code):
        _add(keys, 'mistake_penalty', 'life_decrement', m.group(1))
    for m in re.finditer(
        rf'(?<![\w$.])({LIVES})\s*=\s*(?:Math\.max\(\s*0\s*,\s*)?[^;\n]{{0,80}}?\b{LIVES}\b\s*-',
        code,
    ):
        _add(keys, 'mistake_penalty', 'life_decrement', m.group(1))
    for m in re.finditer(rf'(?<![\w$.])({STREAK_FIELDS})\s*=\s*(?:0|1|[A-Z_]{{3,}}|\d)\b', code):
        _add(keys, 'mistake_penalty', 'streak_reset', m.group(1))

    return keys


# ---------------------------------------------------------------------------
# Focus family: keyframe_animation, scripted_animation
# ---------------------------------------------------------------------------


def _focus_keys(html: str) -> dict:
    css = frozen.css_text(html)
    code = frozen.executable(frozen.script_code(html))
    keys: dict = {}

    # keyframe_animation -- @keyframes rules and non-none animation declarations.
    for m in re.finditer(r'@(?:-webkit-)?keyframes\s+([\w-]+)', css):
        _add(keys, 'keyframe_animation', 'keyframes', m.group(1))
    animation_decl = re.compile(
        r'(?<![\w-])(?:-webkit-)?animation(?:-name)?\s*:\s*'
        r'(?!\s*(?:none|initial|unset|inherit)\s*(?:!important)?\s*[;}"\'])'
        r'([^;}]+)'
    )
    for m in animation_decl.finditer(css):
        _add(keys, 'keyframe_animation', 'animation_declaration', _first_ident(m.group(1)))

    # scripted_animation -- JS-driven motion.
    if re.search(r'\.\s*style\s*\.\s*animation(?:Name)?\s*=(?!=)\s*(?!""|\'\'|null\b)', code):
        _add(keys, 'scripted_animation', 'style_animation', 'element.style.animation')
    if re.search(r'\.\s*animate\s*\(', code):
        _add(keys, 'scripted_animation', 'waapi', 'Element.animate')
    if re.search(r'\brequestAnimationFrame\s*\(', code):
        _add(keys, 'scripted_animation', 'raf', 'requestAnimationFrame')
    for m in re.finditer(r'\bsetInterval\s*\(([\s\S]{0,400})', code):
        window = m.group(1)
        if re.search(r'\.style\s*\.\s*(?:left|top|right|bottom|transform|margin)\s*=', window) or re.search(
            r'translate|transform', window
        ):
            _add(keys, 'scripted_animation', 'setInterval_motion', 'setInterval')
            break

    # scripted_animation -- moving transitions (the calm_motion_broad scope).
    moves = re.search(r'(?<![\w-])transform\s*:\s*(?!\s*none\b)[^;}]+', css)
    for decl in re.findall(r'(?<![\w-])transition(?:-property)?\s*:\s*([^;}]+)', css):
        if re.search(r'\btransform\b', decl):
            _add(keys, 'scripted_animation', 'moving_transition', 'transform')
            break
        if re.search(r'\ball\b', decl) and moves:
            _add(keys, 'scripted_animation', 'moving_transition', 'all-with-transform')
            break

    return keys


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def construct_keys(html: str, stratum: str) -> dict:
    """Trigger-type -> sorted construct-key list for one HTML document."""
    family = family_for_stratum(stratum)
    raw = _game_keys(html) if family == 'game' else _focus_keys(html)
    return {
        trigger: sorted(raw.get(trigger, set()))
        for trigger in FAMILY_TRIGGER_TYPES[family]
    }


def classify(html: str, stratum: str, baseline_html: str) -> dict:
    """Exposure classification for one output against one baseline variant.

    Returns only JSON-native values (no floats): per-trigger-type baseline and
    output key lists, the novel keys, and the run-level ``exposed`` flag.
    """
    family = family_for_stratum(stratum)
    trigger_types = FAMILY_TRIGGER_TYPES[family]
    out_keys = construct_keys(html, stratum)
    base_keys = construct_keys(baseline_html, stratum)

    per_type = {}
    all_baseline = []
    all_output = []
    all_novel = []
    for trigger in trigger_types:
        baseline = base_keys[trigger]
        output = out_keys[trigger]
        novel = sorted(set(output) - set(baseline))
        per_type[trigger] = {
            'baseline_keys': baseline,
            'output_keys': output,
            'novel_keys': novel,
            'exposed': bool(novel),
        }
        all_baseline.extend(baseline)
        all_output.extend(output)
        all_novel.extend(novel)

    return {
        'family': family,
        'trigger_types': per_type,
        'baseline_keys': sorted(set(all_baseline)),
        'output_keys': sorted(set(all_output)),
        'novel_keys': sorted(set(all_novel)),
        'exposed': bool(all_novel),
    }
