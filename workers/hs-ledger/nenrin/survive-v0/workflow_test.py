#!/usr/bin/env python3
"""Exercise both workflow persistence blocks with mocked git/sleep; no network."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[4]


class PersistenceTest(unittest.TestCase):
    def test_both_persistence_blocks(self):
        workflow = (ROOT / '.github/workflows/survive-drill.yml').read_text()
        blocks = []
        lines = workflow.splitlines()
        for i, line in enumerate(lines):
            if line.strip() == 'PUSHED=0':
                end = next(j for j in range(i, len(lines))
                           if lines[j] == '          fi')
                blocks.append('\n'.join(l[10:] for l in lines[i:end + 1]))
        self.assertEqual(len(blocks), 2)
        for index, block in enumerate(blocks):
            for mode, expected_rc, pulls, pushes in (
                ('push-fails', 1, 3, 3),
                ('pull-fails', 1, 3, 0),
                ('recover', 0, 3, 3),
                ('success', 0, 1, 1),
            ):
                with self.subTest(block=index, mode=mode):
                    mock = '''
PULLS=0; PUSHES=0
sleep() { :; }
git() {
  if [ "$1" = pull ]; then
    PULLS=$((PULLS + 1))
    [ "$MODE" != pull-fails ]
  else
    PUSHES=$((PUSHES + 1))
    [ "$MODE" = success ] || { [ "$MODE" = recover ] && [ "$PUSHES" -eq 3 ]; }
  fi
}
trap 'echo "calls=$PULLS,$PUSHES"' EXIT
'''
                    result = subprocess.run(['bash', '-e', '-c',
                                             'MODE=' + mode + '\n' + mock + block],
                                            text=True, capture_output=True)
                    self.assertEqual(result.returncode, expected_rc, result.stdout + result.stderr)
                    self.assertIn(f'calls={pulls},{pushes}', result.stdout)
                    self.assertEqual('::error::' in result.stdout, expected_rc != 0)


if __name__ == '__main__':
    unittest.main()
