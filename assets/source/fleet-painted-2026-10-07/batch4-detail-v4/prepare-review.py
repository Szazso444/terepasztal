from pathlib import Path
R=Path(__file__).resolve().parent;qa=Path('C:/Users/Zso/terepasztal-playtest/scratchpad/models/handover-review')
for src,dst in [('capture-wheel-v3.mjs','capture-detail-v4.mjs'),('capture-wheel-details.mjs','capture-detail-v4-closeups.mjs'),('build-wheel-v3.py','build-detail-v4.py')]:
 text=(qa/src).read_text(encoding='utf-8').replace('wheel-v3','detail-v4')
 if dst=='build-detail-v4.py':
  text=text.replace("root/'width-v2/after'","root/'wheel-v3/after'")
  text=text.replace("extra='25%-kal keskenyebb wide sín. Új, referenciából felépített kerekek és tengelyelrendezés; a kerekek nem érnek egymásba.'", "extra={'mav375':'A nem létező hátsó kerékpár eltávolítva: három hajtott tengely.','class08':'A test tengelye a sínhez igazítva.','sw1':'Középre igazított, szélesebb és szimmetrikus motorház.','drg01':'25%-kal kisebb kerekek, hátrébb helyezett első forgóváz, sínhez igazított test.','m62':'Teljes forgóvázkeret: első és hátsó keresztmerevítő, hossztartók, középső tartó és vontatómotorok.'}[id]+' A lámpapozíciókat az exportáló most átadja a játéknak; az ablakfény a test saját maszkját követi.'")
  text=text.replace('Előző szélességjavítás — hibás kerékrendszer','Előző változat (wheel-v3)').replace('Új kerékrendszer a keskenyebb wide sínen','Javított modell').replace('Új kerékrendszer és keskenyebb wide sín','Geometria és fényforrások javítása')
  text=text.replace('A wide sín, a talpfák és az ágyazat 25%-kal keskenyebb. A narrow sín változatlan. A kerekek tengelyhelyeit, átmérőit és forgóvázait a referenciák alapján újraépítettem. Az M62 az eredeti képből rekonstruált formát használja.','Az öt mozdony javítása a legutóbbi észrevételeid alapján. A wide sín maradt a választott 25%-kal keskenyebb változat. A referenciafüzet javított változata: v9.')
  text=text.replace("if (dest/'detail.png').exists():pictures+=figure('detail.png','Nagyított kerék- és sínillesztés')", "if (dest/'detail.png').exists():pictures+=figure('detail.png','Nagyított kerék- és sínillesztés')\n    if (source/f'{id}-lights.png').exists():\n        shutil.copy2(source/f'{id}-lights.png',dest/'lights.png');pictures+=figure('lights.png','Fényforrások közelről')")
 (qa/dst).write_text(text,encoding='utf-8')
print('Review scripts prepared')
