from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as E
import hashlib,json,shutil
R=Path(__file__).resolve().parent;old=Path('G:/DEV/Terepasztal/locomotive-wheels-bogies-v8.xlsx');new=R/'locomotive-wheels-bogies-v9.xlsx'
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def contents(path):
 with ZipFile(path) as z:
  ss=E.fromstring(z.read('xl/sharedStrings.xml')) if 'xl/sharedStrings.xml' in z.namelist() else []
  strings=[''.join(n.itertext()) for n in ss]
  sheets={}
  for name in z.namelist():
   if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
    cells={}
    for c in E.fromstring(z.read(name)).findall('.//s:c',NS):
     f=c.find('s:f',NS);v=c.find('s:v',NS);val=v.text if v is not None else None
     if c.get('t')=='s':val=strings[int(val)] if val is not None else None
     elif c.get('t')=='inlineStr':val=''.join(c.find('s:is',NS).itertext())
     if f is not None:val='='+f.text
     if val is not None:cells[c.get('r')]=val
    sheets[name]=cells
  images=sorted(hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if n.startswith('xl/media/'))
 return sheets,images
a,ai=contents(old);b,bi=contents(new);changes=[]
for sheet in a:
 for cell in sorted(a[sheet].keys()|b[sheet].keys()):
  if a[sheet].get(cell)!=b[sheet].get(cell):changes.append([sheet,cell,a[sheet].get(cell),b[sheet].get(cell)])
(R/'workbook-diff.json').write_text(json.dumps(changes,indent=2))
print('Images preserved:',ai==bi,'Cell changes:',len(changes));print([(s,c) for s,c,*_ in changes])
assert ai==bi,'Reference images changed'
