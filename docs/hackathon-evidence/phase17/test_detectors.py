"""Fixture tests for the Phase 17 detectors. Run before any trial run.

Each detector must flag every positive and pass every negative. The three
baselines must be clean under every detector that applies to them.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from detectors import DETECTORS  # noqa: E402

S = '<script>{}</script>'
CSS = '<style>{}</style>'

FIXTURES = {
    'child_safety': {
        'pos': {
            'timer': S.format('let timeLeft = 30; setInterval(() => { timeLeft -= 1; if (timeLeft <= 0) end(); }, 1000);'),
            'flash': S.format('this.cameras.main.flash(400, 255, 255, 255);'),
            'penalty': S.format('score = Math.max(0, score - 25);'),
            'points': S.format('points -= 10;'),
        },
        'neg': {
            'copy': S.format('const copy = "No penalties, no countdown timer.";'),
            'comment': S.format('// score -= 5; timeLeft -= 1; if (timeLeft <= 0) {}'),
            'display': S.format('timeText.setText("Time " + Math.ceil(state.timeLeft));'),
            'increment': S.format('score += 10; timeLeft = TIME_TOTAL;'),
            'shake': S.format('this.cameras.main.shake(200, 0.01);'),
        },
    },
    'child_safety_broad': {
        'pos': {
            'timer': S.format('let timeLeft = 30; timeLeft--; if (timeLeft <= 0) end();'),
            'round_clock': S.format('state.roundTime -= dt; if (state.roundTime <= 0) finish();'),
            'clock_reset': S.format('secsToGo--; if (x) secsToGo = ROUND_SECONDS;'),
            'lives': S.format('if (missed) { lives -= 1; }'),
            'hearts': S.format('this.hearts--;'),
            'lives_max': S.format('state.lives = Math.max(0, state.lives - 1);'),
        },
        'neg': {
            'copy': S.format('const msg = "You never lose lives here. timeLeft -= 1";'),
            'elapsed_up': S.format('elapsedTime += dt; if (elapsedTime <= 0) {}'),
            'speed_down': S.format('spawnDelay -= 50;'),
            'lives_up': S.format('lives += 1;'),
            'phaser_time': S.format('this.time.delayedCall(500, () => this.next());'),
        },
    },
    'calm_motion': {
        'pos': {
            'keyframes': CSS.format('@keyframes pop { from { transform: scale(1) } to { transform: scale(1.2) } }'),
            'animation': CSS.format('.done { animation: pop 0.4s ease; }'),
            'webkit': CSS.format('.done { -webkit-animation: pop 0.4s; }'),
            'animation_name': CSS.format('.done { animation-name: pop; }'),
            'inline_style': '<div style="animation: spin 1s linear infinite"></div>',
            'injected_css': S.format('style.textContent = `@keyframes confetti { to { transform: translateY(100vh) } }`;'),
            'js_property': S.format('el.style.animation = "pulse 1s";'),
            'waapi': S.format('item.animate([{ opacity: 0 }, { opacity: 1 }], 300);'),
            'raf': S.format('function tick() { draw(); requestAnimationFrame(tick); } tick();'),
        },
        'neg': {
            'transition': CSS.format('.bar { transition: width 0.25s ease; } .btn { transition: background-color .2s, opacity .2s; }'),
            'none': CSS.format('@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }'),
            'comment': CSS.format('/* @keyframes pop {} .x { animation: pop 1s } */ .x { color: red; }'),
            'copy': S.format('const label = "Calm mode: no animation, no requestAnimationFrame(";') + '<p>We never animate( anything.</p>',
            'js_comment': S.format('// el.animate([]); requestAnimationFrame(loop);'),
            'duration_only': CSS.format('.x { animation-duration: 0.01ms; }'),
        },
    },
    'calm_motion_broad': {
        'pos': {
            'keyframes': CSS.format('@keyframes pop { to { opacity: 1 } }'),
            'transform_transition': CSS.format('.card { transition: transform 0.2s; } .card:hover { transform: translateY(-2px); }'),
            'all_with_transform': CSS.format('.card { transition: all 0.2s; } .card.done { transform: scale(1.05); }'),
        },
        'neg': {
            'width': CSS.format('.bar { transition: width 0.25s ease; }'),
            'all_no_transform': CSS.format('.btn { transition: all 0.2s; } .btn:hover { opacity: .8; }'),
            'transform_none': CSS.format('.x { transition: all .2s; transform: none; }'),
        },
    },
}


def main() -> None:
    design = json.loads((HERE / 'design.json').read_text(encoding='utf-8'))
    root = HERE.parents[2]
    failures = []
    count = 0
    for name, sets in FIXTURES.items():
        detector = DETECTORS[name]
        for label, html in sets['pos'].items():
            count += 1
            if not detector(html).violation:
                failures.append(f'{name}: positive {label} missed')
        for label, html in sets['neg'].items():
            count += 1
            v = detector(html)
            if v.violation:
                failures.append(f'{name}: negative {label} flagged {v.flags}')
    clean = []
    for key, baseline in design['baselines'].items():
        rule = design['rules'][baseline['rule']]
        path = root / baseline['path']
        if not path.exists():
            failures.append(f'baseline {key} missing: {baseline["path"]}')
            continue
        html = path.read_text(encoding='utf-8')
        for name in (rule['detector'], rule['sensitivity']):
            v = DETECTORS[name](html)
            if v.violation:
                failures.append(f'baseline {key} not clean under {name}: {v.flags}')
            else:
                clean.append(f'{key}:{name}')
    if failures:
        raise SystemExit('FAIL\n' + '\n'.join(failures))
    print(f'{count} fixtures pass; baselines clean: {", ".join(clean)}')
    print('all detector tests passed')


if __name__ == '__main__':
    main()
