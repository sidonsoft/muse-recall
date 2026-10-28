"""Phase 17 power simulation (deterministic). Usage: python3 -I power.py

Simulates one model's trial: 6 strata x 4 arms x k runs, a share of runs
unusable at random, and the pre-registered tests at their pre-registered
levels: H1 and H3 exact stratified tests under Holm (family alpha .05), H2
non-inferiority of memory to manual repetition (upper 90% Newcombe bound of
memory minus manual below the margin). Reports the probability that each hypothesis is supported.
"""
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stats17 import holm, newcombe, stratified_exact  # noqa: E402

MARGIN = 0.15
SCENARIOS = {
    # no-memory rate per stratum (farm x2, orchard x2, focus x2); memory = manual rate; corrected rate
    'expected': {'none': [1.0, 0.9, 0.9, 0.8, 0.8, 0.7], 'memory': 0.03, 'corrected': 'none'},
    'pessimistic': {'none': [0.9, 0.7, 0.7, 0.6, 0.5, 0.4], 'memory': 0.10, 'corrected': 'half'},
}


def simulate(k: int, scenario: dict, unusable: float, rng: random.Random) -> dict[str, bool]:
    def draw(p: float) -> tuple[int, int]:
        n = sum(rng.random() >= unusable for _ in range(k))
        return sum(rng.random() < p for _ in range(n)), n

    s_h1, s_h3, mem_k, mem_n, man_k, man_n = [], [], 0, 0, 0, 0
    for p_none in scenario['none']:
        p_corr = p_none if scenario['corrected'] == 'none' else (p_none + scenario['memory']) / 2
        none, mem, man, corr = draw(p_none), draw(scenario['memory']), draw(scenario['memory']), draw(p_corr)
        s_h1.append((*mem, *none))
        s_h3.append((*corr, *mem))
        mem_k, mem_n, man_k, man_n = mem_k + mem[0], mem_n + mem[1], man_k + man[0], man_n + man[1]
    rejected = holm({'H1': stratified_exact(s_h1), 'H3': stratified_exact(s_h3)}, 0.05)
    _, lo, hi = newcombe(mem_k, mem_n, man_k, man_n, 0.90)
    return {'H1': rejected['H1'], 'H2': hi < MARGIN, 'H3': rejected['H3']}


def main() -> None:
    reps = 2000
    print(f'{"k/cell":>6} {"runs/model":>10} {"scenario":>12} {"unusable":>8}   H1    H2    H3')
    for k in (6, 8, 10, 12):
        for name, scenario in SCENARIOS.items():
            for unusable in (0.0, 0.25):
                rng = random.Random(f'phase17-power-{k}-{name}-{unusable}')
                hits = {'H1': 0, 'H2': 0, 'H3': 0}
                for _ in range(reps):
                    for h, ok in simulate(k, scenario, unusable, rng).items():
                        hits[h] += ok
                cols = '  '.join(f'{hits[h] / reps:.2f}' for h in ('H1', 'H2', 'H3'))
                print(f'{k:>6} {k * 24:>10} {name:>12} {unusable:>8.2f}   {cols}')


if __name__ == '__main__':
    main()
