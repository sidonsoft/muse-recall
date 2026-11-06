"""Frozen, study-local copies of the Phase 17 rule detectors.

Provenance
----------
The two files under ``scoring/phase17/`` and ``scoring/phase16/`` are *verbatim
byte copies* of the locked Phase 17 detector and the Phase 16 child-safety
detector. Their SHA-256 values are identical to the originals pinned in
``docs/hackathon-evidence/phase17/protocol.sha256``::

    96ced5971c816547058ea1af2cb3fa64e83e9a402d1a0e3b881253c84bfab790  phase17/detectors.py
    b154dc31227a2ad26c57adf0eb17e01f627363a6ad9b3b4939e8f9f089e626b2  phase16/detector.py

The directory layout is preserved so the frozen Phase 17 copy's own
``sys.path.insert(... / 'phase16')`` resolves to the frozen Phase 16 copy on
this machine and *not* to the locked originals: a later edit to either
original cannot change Study 02's scoring endpoint, and deleting the originals
cannot break it either.

This module is the only import surface for scoring. It exposes exactly
``child_safety``, ``child_safety_broad``, ``calm_motion``, ``calm_motion_broad``
(plus the shared pre-processing helpers and ``Verdict``) and verifies the
copies against the pinned hashes on import. A mismatch is a hard failure.
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PHASE17_DIR = HERE / 'phase17'
PHASE16_DIR = HERE / 'phase16'

#: SHA-256 of the verbatim copies, equal to the originals in protocol.sha256.
PINNED = {
    'phase17/detectors.py': '96ced5971c816547058ea1af2cb3fa64e83e9a402d1a0e3b881253c84bfab790',
    'phase16/detector.py': 'b154dc31227a2ad26c57adf0eb17e01f627363a6ad9b3b4939e8f9f089e626b2',
}

#: Original, locked locations as recorded in phase17/protocol.sha256.
ORIGINALS = {
    'phase17/detectors.py': 'docs/hackathon-evidence/phase17/detectors.py',
    'phase16/detector.py': 'docs/hackathon-evidence/phase16/detector.py',
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def sha256_file(path) -> str:
    return sha256_bytes(Path(path).read_bytes())


def frozen_hashes() -> dict:
    """SHA-256 of each frozen copy as currently on disk (no verification)."""
    return {rel: sha256_bytes((HERE / rel).read_bytes()) for rel in PINNED}


def verify(verbose: bool = False) -> dict:
    """Fail closed if a frozen copy is missing or no longer byte-identical."""
    actual = {}
    problems = []
    for rel, expected in PINNED.items():
        path = HERE / rel
        if not path.exists():
            problems.append(f'missing frozen copy: {rel}')
            continue
        got = sha256_bytes(path.read_bytes())
        actual[rel] = got
        if got != expected:
            problems.append(f'{rel}: sha256 {got} != pinned {expected}')
    if problems:
        raise RuntimeError('frozen detector copies invalid:\n' + '\n'.join(problems))
    if verbose:
        for rel, got in actual.items():
            print(f'{rel}: {got} OK ({ORIGINALS[rel]})')
    return actual


verify()

# The frozen Phase 17 module imports `detector` from its sibling phase16 copy
# via its own path manipulation; import it now that the copies are verified.
if str(PHASE17_DIR) not in sys.path:
    sys.path.insert(0, str(PHASE17_DIR))
from detectors import (  # noqa: E402
    DETECTORS,
    Verdict,
    calm_motion,
    calm_motion_broad,
    child_safety,
    child_safety_broad,
    css_text,
    executable,
    script_code,
)

__all__ = [
    'DETECTORS',
    'PINNED',
    'ORIGINALS',
    'Verdict',
    'calm_motion',
    'calm_motion_broad',
    'child_safety',
    'child_safety_broad',
    'css_text',
    'executable',
    'frozen_hashes',
    'script_code',
    'sha256_bytes',
    'sha256_file',
    'sha256_text',
    'verify',
]


if __name__ == '__main__':
    import json

    print(json.dumps({'pinned': PINNED, 'actual': frozen_hashes(), 'originals': ORIGINALS}, indent=2, sort_keys=True))
