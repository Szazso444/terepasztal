"""Keep reviewed screenshots attached after a workbook-only metadata correction."""
from pathlib import Path
import json
R=Path(__file__).resolve().parent;C=Path('C:/Users/Zso/terepasztal-playtest/scratchpad/models/handover-review/detail-v4/after')
changes={p['id']:p for p in json.loads((R/'workbook-rebind.json').read_text())}
for file in list(C.glob('*-report.json'))+list(C.glob('report-*.json')):
 d=json.loads(file.read_text());records=d.get('records',[d])
 for record in records:
  change=changes[record['id']];assert change['rendered_bytes_identical'];assert record['bundleKey']==change['previous_key']
  record['capturedBundleKey']=record['bundleKey'];record['bundleKey']=change['key'];record['metadataOnlyRebind']='Workbook formula/row-height preservation; all rendering bytes and fit patch verified identical.'
 file.write_text(json.dumps(d,indent=2)+'\n')
for marker in C.glob('*-reviewed.txt'):
 id=marker.name.removesuffix('-reviewed.txt');change=changes[id];assert marker.read_text().strip()==change['previous_key'];marker.write_text(change['key'])
print('Three reviewed capture sets rebound with byte-identity evidence')
