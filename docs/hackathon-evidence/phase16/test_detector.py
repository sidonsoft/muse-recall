from detector import detect_html

POS = {
    'timer': '<script>let timeLeft = 30; setInterval(() => { timeLeft -= 1; if (timeLeft <= 0) end(); }, 1000);</script>',
    'flash': '<script>cameras.main.flash(400, 255, 255, 255);</script>',
    'penalty': '<script>score = Math.max(0, score - 25);</script>',
    'penalty2': '<script>points -= 10;</script>',
}
NEG = {
    'text': '<script>const copy = "No penalties, no countdown timer.";</script>',
    'comment': '<script>// score -= 5; timeLeft -= 1; if (timeLeft <= 0) {}</script>',
    'display': '<script>timeText.setText("Time " + Math.ceil(state.timeLeft));</script>',
    'plus': '<script>score += 10; timeLeft = TIME_TOTAL;</script>',
}

if __name__ == '__main__':
    failures = []
    for name, html in POS.items():
        v = detect_html(html)
        if not v.violation:
            failures.append(('positive missed', name))
        print('POS', name, v)
    for name, html in NEG.items():
        v = detect_html(html)
        if v.violation:
            failures.append(('negative flagged', name, v))
        print('NEG', name, v)
    if failures:
        raise SystemExit(f'FAIL {failures}')
    print('all detector tests passed')
