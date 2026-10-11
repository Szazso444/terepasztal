"""Transfer only Artifact Tool's authored cell values into the original XLSX package.

All original images, relationships, styles and other sheets remain byte-identical.
"""
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import json
import re

HERE = Path(__file__).parent
SOURCE = Path('G:/DEV/Terepasztal/locomotive-wheels-bogies-v7.xlsx')
OUT = SOURCE.with_name('locomotive-wheels-bogies-v8.xlsx')
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
edits = json.loads((HERE / 'workbook-edits.json').read_text())
with ZipFile(SOURCE) as original, ZipFile(HERE / 'workbook-edited.xlsx') as authored:
    tree = ET.fromstring(authored.read('xl/worksheets/sheet1.xml'))
    strings = []
    if 'xl/sharedStrings.xml' in authored.namelist():
        strings = [''.join(e.itertext()) for e in ET.fromstring(authored.read('xl/sharedStrings.xml'))]
    cells = {c.attrib['r']: c for c in tree.findall('.//s:c', NS)}
    xml = original.read('xl/worksheets/sheet1.xml').decode('utf-8')
    expected = {}
    for ref in edits:
        cell = cells[ref]
        value = cell.find('s:v', NS)
        text = strings[int(value.text)] if cell.get('t') == 's' else (value.text if value is not None else ''.join(cell.find('s:is', NS).itertext()))
        expected[ref] = text
        pattern = rf'<c\b[^>]*\br="{ref}"[^>]*(?:/>|>.*?</c>)'
        match = re.search(pattern, xml)
        if not match:
            raise RuntimeError(f'Missing original cell {ref}')
        style = re.search(r'\bs="([^"]+)"', match.group())
        style_attr = f' s="{style[1]}"' if style else ''
        escaped = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        replacement = f'<c r="{ref}"{style_attr} t="inlineStr"><is><t xml:space="preserve">{escaped}</t></is></c>'
        xml = xml[:match.start()] + replacement + xml[match.end():]
    with ZipFile(OUT, 'w') as result:
        for entry in original.infolist():
            result.writestr(entry, xml.encode('utf-8') if entry.filename == 'xl/worksheets/sheet1.xml' else original.read(entry))
with ZipFile(SOURCE) as original, ZipFile(OUT) as result:
    changed = [name for name in original.namelist() if original.read(name) != result.read(name)]
    assert changed == ['xl/worksheets/sheet1.xml'], changed
    final = ET.fromstring(result.read(changed[0]))
    final_cells = {c.attrib['r']: c for c in final.findall('.//s:c', NS)}
    for ref, value in expected.items():
        assert ''.join(final_cells[ref].find('s:is', NS).itertext()) == value
    media = [name for name in original.namelist() if name.startswith('xl/media/')]
    print(f'v8 saved: {len(edits)} cells verified; {len(media)} embedded media files byte-identical; all other package parts unchanged.')
