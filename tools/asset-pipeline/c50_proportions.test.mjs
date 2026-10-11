import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

it('matches hood widths and widens the deck 40% without changing cab, wheel centres, length or height', () => {
  const result = JSON.parse(execFileSync(process.env.PYTHON ?? 'python', ['-c', `
import json,numpy as np
from c50_proportions import correct_widths
p=[]
for x,width in [(1.,1.2),(-2.1,1.5)]:
 for y in np.linspace(-width/2,width/2,101):p.append([x,y,1.4])
checks=[[-.8,.75,1.8],[-.915,-.57,.475],[.535,.57,.475],[0.,-.8,.9],[0.,.9,.9]]
p=np.array(p+checks);q,report=correct_widths(p)
print(json.dumps({'checks':q[-5:].tolist(),'unchanged_xz':bool(np.array_equal(p[:,[0,2]],q[:,[0,2]])),
 'front_width':float(np.ptp(q[:101,1])),'rear_width':float(np.ptp(q[101:202,1]))}))
`], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8' }));
  expect(result.unchanged_xz).toBe(true);
  expect(result.front_width).toBeCloseTo(result.rear_width);
  expect(result.checks.slice(0, 3)).toEqual([[-.8, .75, 1.8], [-.915, -.57, .475], [.535, .57, .475]]);
  expect(result.checks[4][1] - result.checks[3][1]).toBeCloseTo(1.7 * 1.4);
});
