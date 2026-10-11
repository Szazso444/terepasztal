import fs from 'node:fs/promises';
import {FileBlob, SpreadsheetFile} from '@oai/artifact-tool';
const root = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load('G:/DEV/Terepasztal/locomotive-wheels-bogies-v8.xlsx'));
console.log((await wb.inspect({kind:'sheet',include:'id,name',maxChars:1000})).ndjson);
const sheet=wb.worksheets.getItem('Locomotives');
const data={};
for(const row of [1,2,3,4,15,17,21,25,30])data[row]=sheet.getRange(`A${row}:CI${row}`).values;
data.groups=wb.worksheets.getItem('Bogie groups').getRange('A1:K94').values;
await fs.writeFile(root+'/workbook-rows.json',JSON.stringify(data,null,2));
console.log('Relevant workbook rows extracted.');
if(process.argv.includes('--edit')){
 const notes={
  15:'2026-10-08 owner correction: The model image has only three coupled driving axles. Remove the nonexistent rearmost small wheel pair. No separate trailing axle in this illustration. Lamp and window light must originate on the visible lenses and glazing.',
  17:'2026-10-08 owner correction: Align the body longitudinal axis parallel to straight rails. Preserve the reference shape. Calibrate lamp and window light to the actual lenses and glazing.',
  21:'2026-10-08 owner correction: Centre the nose on the chassis, widen the narrow hood and make the body bilaterally symmetric in plan view. Calibrate lamp and window light to the actual lenses and glazing.',
  25:'2026-10-08 owner correction: Reduce all model wheel diameters by approximately 25% relative to wheel-v3. Move the leading bogie centre rearward below the cylinder assembly as marked in the owner image (current correction: 0.70 model metres). Align the engine body parallel to straight rails. Calibrate lamp and window light to the actual lenses and glazing.',
  30:'2026-10-08 owner: Body shape accepted. Render each swivelling bogie as a complete assembly, including front and rear crossmembers, longitudinal frames, centre bolster and traction motors; not only wheels. Calibrate lamp and window light to the actual lenses and glazing.'
 };
 sheet.getRange('G15').values=[['0-6-0T as illustrated (owner correction)']];
 sheet.getRange('H15').formulas=[['=COUNTA(I15:X15)']];
 sheet.getRange('I15:L15').values=[['driver','driver','driver',null]];
 sheet.getRange('Y15').values=[['Frame [body]: 1-3 (rigid coupled drivers; 2 virtual rail supports)']];
 sheet.getRange('AA15').values=[['Three coupled wheel pairs are shown. The rear step is not a fourth wheel. This describes the illustration; the prototype arrangement remains separately recorded.']];
 sheet.getRange('CA15').values=[['One rigid chassis with 3 coupled driving axles (6 wheels), baked into the body artwork. The solver uses 2 virtual rail supports, not physical bogies.']];
 sheet.getRange('CI4').values=[["Owner's model review (latest: 2026-10-08)"]];
 for(const [row,note] of Object.entries(notes)){
  const cell=sheet.getRange(`CI${row}`);cell.values=[[note+'\n\nEarlier review:\n'+(cell.values[0][0]??'')]];
 }
 const groups=wb.worksheets.getItem('Bogie groups');
 groups.getRange('H14:I14').values=[['1-3',3]];
 groups.getRange('K14').values=[['Owner 2026-10-08: no rearmost small wheel pair in the model image.']];
 groups.getRange('K37').values=[['Owner 2026-10-08: leading bogie centre below cylinder assembly, 0.70 model metres rearward of wheel-v3. Wheel diameters 25% smaller.']];
 for(const row of [51,52])groups.getRange(`K${row}`).values=[['Complete swivelling frame with front and rear crossmembers, bolster and traction motors.']];
 for(const row of [14,37,51,52]){groups.getRange(`K${row}`).format.wrapText=true;groups.getRange(`A${row}:K${row}`).format.rowHeight=70;}
 wb.recalculate();
 console.log((await wb.inspect({kind:'table',range:'Locomotives!G15:L15',include:'values,formulas',maxChars:900,tableMaxRows:1,tableMaxCols:6})).ndjson);
 await fs.writeFile(root+'/workbook-wheel-review.png',new Uint8Array(await (await wb.render({sheetName:'Locomotives',range:'G14:L15',scale:1.5})).arrayBuffer()));
 await fs.writeFile(root+'/workbook-notes-review.png',new Uint8Array(await (await wb.render({sheetName:'Locomotives',range:'CI15:CI15',scale:1})).arrayBuffer()));
 await fs.writeFile(root+'/workbook-bogie-review.png',new Uint8Array(await (await wb.render({sheetName:'Bogie groups',range:'G37:K37',scale:1})).arrayBuffer()));
 await (await SpreadsheetFile.exportXlsx(wb)).save(root+'/locomotive-wheels-bogies-v9.xlsx');
 console.log('Updated workbook exported for preservation checks.');
}
