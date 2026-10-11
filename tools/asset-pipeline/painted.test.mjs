import { it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

it('keeps painted pipeline source locks, atlas bounds, anchors and installation ownership', () => {
  execFileSync(process.env.PYTHON ?? 'python', ['-m', 'unittest', 'test_pipeline'], {
    cwd: fileURLToPath(new URL('./painted/', import.meta.url)),
    encoding: 'utf8',
  });
});
