import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const dir = new URL('.', import.meta.url);
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load('G:/DEV/Terepasztal/locomotive-wheels-bogies-v7.xlsx'));
console.log((await wb.inspect({kind:'workbook,sheet,table',maxChars:2500,tableMaxRows:2,tableMaxCols:5})).ndjson);
const sheet = wb.worksheets.getItem('Locomotives');
await fs.writeFile(new URL('workbook-values.json', dir), JSON.stringify(sheet.getUsedRange().values));
const preview = await wb.render({sheetName:'Locomotives',range:'A1:D5',scale:1});
await fs.writeFile(new URL('workbook-before.png',dir),new Uint8Array(await preview.arrayBuffer()));
if (process.argv.includes('--edit')) {
  const notes = {
    4: 'Wrong angles and distorted body. Show the original reconstructed model without modifications.',
    11: 'Wheels do not match the source picture: they are smaller in the game.',
    16: 'Incomplete body side above the wheels. Wrong angles and distorted in-game model. Important engine; take care.',
    18: 'Distorted, wrong angles and stretched. Show the original model.',
    19: 'Clips throughout; wheels overlap. Three groups of three wheel pairs: middle fixed to the body, front and rear swivelling. Each group has a connecting rod. Important, complicated model; ask the owner if unclear.',
    20: 'No model has matched the picture. Two bogies of three wheel pairs. The missing centre tank belongs to the body. Model is squashed and does not sit properly on the rails.',
    21: 'Same distortion and angle problems as Black Five, but this model looks better. Tender does not fit the rails. At the front only the angles are wrong. Restore the original model.',
    24: 'Fine overall. Front bogie is a little odd; a piece is missing between the wheels.',
    27: 'Wheels remain on the model and are rendered separately too. Keep one representation so the engine looks like one piece.',
    30: 'Wrong angles and slight distortion. Close, but correct it. Important engine.',
    32: 'Same as Black Five: distorted, wrong angles and stretched. Show the original model.',
    33: 'Improved. Cover the hinge with bellows like an articulated bus. The hinged part drifts too far out on curves and must follow the curve more closely. Iconic engine.',
    34: 'Essentially the same as Kando V40: incomplete body side above the wheels, wrong angles and distortion.',
    38: 'Wheels are too small compared with the model. Owner arrangement, front to rear: one wheel pair behind the snowplough; four rod-coupled pairs as one bogie; three rod-coupled pairs as another bogie. Tender: two bogies of three pairs each. First pair behind the plough has uncertain attachment; omit it if its place can be patched.'
  };
  const retired = new Set([9,10,12,15,22,23,25,31,35,36]);
  const values = sheet.getUsedRange().values;
  const edits = [];
  const set = (cell,value) => { sheet.getRange(cell).values=[[value]]; edits.push(cell); };
  set('CI4', "Owner's model review (latest: 2026-10-06)");
  for(let i=4;i<values.length;i++) {
    const n=values[i][0], row=i+1;
    if (retired.has(n)) {
      set(`D${row}`, 'Not in game (retired model). Existing saved copies remain compatible.');
      set(`CF${row}`, 'retired - not in game');
      set(`CG${row}`, `2026-10-06: Model excluded from the demo roster at the owner's request. ` + (values[i][84] || ''));
      notes[n] = n===9 || n===10 ? 'Already retired in the game; workbook status corrected.' :
        'Retire this model for now.' + ([12,15].includes(n) ? ' Repeated problems; a similar-looking model exists.' : '');
    }
    if (notes[n]) set(`CI${row}`, '2026-10-06: ' + notes[n] + '\n\nEarlier review: ' + (values[i][86] || 'None recorded.'));
  }
  // Apply the fleet-wide instructions to active models, retaining their individual review history.
  for(let i=4;i<values.length;i++) {
    const n=values[i][0], row=i+1;
    if(!Number.isInteger(n) || retired.has(n) || n===39) continue;
    const cell=`CI${row}`;
    const current=sheet.getRange(cell).values[0][0] || '';
    set(cell, current + '\n\n2026-10-06, fleet: Stop mesh reshaping and bending sprites between headings. Align the whole reconstructed model rigidly, use one uniform scale, and render actual 3D headings. Review originals for 4, 18, 21 and 32 before a fleet rerender. Discuss far-side mirroring and gear widening first; rail gauge stays. Remaining faults where applicable: pulsing on turns, poor cut surfaces, split-looking fronts. Other individual models are accepted.');
  }
  await fs.writeFile(new URL('workbook-edits.json',dir),JSON.stringify([...new Set(edits)]));
  const previewAfter=await wb.render({sheetName:'Locomotives',range:'CF22:CI22',scale:1});
  await fs.writeFile(new URL('workbook-after.png',dir),new Uint8Array(await previewAfter.arrayBuffer()));
  console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!',options:{useRegex:true,maxResults:10},maxChars:1000})).ndjson);
  await (await SpreadsheetFile.exportXlsx(wb)).save(new URL('workbook-edited.xlsx',dir).pathname.replace(/^\/([A-Z]:)/,'$1'));
  console.log(`Edited ${new Set(edits).size} cells`);
}
