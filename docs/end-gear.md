# Where each prototype hangs its end gear

Web research (2026-09-26) for the rendered rolling stock: pilots and snowplows, couplers, buffers and end
steps go where the prototype mounts them. **Body** means the body, underframe or rigid main frame; they are
drawn with the body sprite. **Running gear** means a bogie or articulated frame that turns under the body; they
are drawn with that train's own bogie sprite (`attach` in `tools/asset-pipeline/landmarks.json`) and turn with
it. Rows marked (?) rest on thin sources (photos, model-maker notes) and deserve a second look before rendering.

| Locomotive | Pilot / snowplow / track clearer | Coupler | Buffers | End steps |
|---|---|---|---|---|
| LNER A3 Flying Scotsman | none; guard irons on the main frame | body (buffer beam); tender gear on the tender frame | body | body |
| EMD F7 A | body underframe | body underframe | none | body |
| EMD SD40-2 | body (plough pilot on the end sill) | body | none | body; HT-C trucks carry nothing |
| Stephenson's Rocket (?) | none | body (drawbar to the tender) | none as built | none |
| EMD SW1 | body | body | none | body (footboards, later corner steps) |
| BR Class 08 | guard irons on the main frame (rigid 0-6-0) | body | body | body |
| M62 | body | body (SA-3, or hook and screw coupling) | body (export versions) | body |
| BR Class 55 Deltic (?) | body valance; guard irons possibly on the bogies | body | body | lowest cab step on the bogie |
| UP DDA40X | body | body | none | body |
| MÁV Kandó V40 (?) | body (rigid main frame) | body | body | body |
| MÁV V63 Gigant (?) | body, under the buffer beam | body | body | body |
| SBB Ce 6/8 II Crocodile (?) | running gear (the hood frames) | running gear | running gear | running gear |
| ÖBB 1116 Taurus | body (rail guard on the body frame) | body | body | body |
| SBB Re 460 (?) | body (front skirt) | body | body | body |
| PRR GG1 (?) | running gear (articulated frames) | running gear (?) | none | body |
| TGV Sud-Est power car (?) | body (nose skirt) | body (Scharfenberg behind nose flaps) | none at the nose | body |
| ICE 1 power car (?) | body (nose skirt) | body (emergency coupler) | none at the nose | body |
| Rigid-frame steam (DRG 01, K4s, 4449, A4, Black Five, 9F, MÁV 424/375, J94, Adler, General, Jupiter) | main frame | main frame | main frame | main frame |
| UP Big Boy | front engine unit (hinged frame) | front engine unit | none | front engine unit |
| SAR GMAM Garratt | engine units | engine units | engine units | engine units |
| John Bull | its lead truck | frame | frame | frame |

**Pattern.** North American diesels carry everything on the underframe; their trucks carry nothing.
Rigid-frame engines carry it on the main-frame buffer beams. European bogie locomotives carry buffers and
drawgear on the body, track clearers mostly too. Articulated designs whose body is a passive shell (Crocodile,
GG1, Garratt, Big Boy front unit) carry it on the running-gear frames, which in the game are bogie sprites.

**Sources.** Wikipedia: [LNER Class A1/A3](https://en.wikipedia.org/wiki/LNER_Class_A1/A3),
[Buffers and chain coupler](https://en.wikipedia.org/wiki/Buffers_and_chain_coupler),
[EMD F-unit](https://en.wikipedia.org/wiki/EMD_F-unit), [EMD SD40-2](https://en.wikipedia.org/wiki/EMD_SD40-2),
[Stephenson's Rocket](https://en.wikipedia.org/wiki/Stephenson%27s_Rocket),
[Planet](https://en.wikipedia.org/wiki/Planet_(locomotive)), [EMD SW1](https://en.wikipedia.org/wiki/EMD_SW1),
[British Rail Class 08](https://en.wikipedia.org/wiki/British_Rail_Class_08),
[М62](https://ru.wikipedia.org/wiki/М62_(тепловоз)),
[British Rail Class 55](https://en.wikipedia.org/wiki/British_Rail_Class_55),
[EMD DDA40X](https://en.wikipedia.org/wiki/EMD_DDA40X),
[MÁV V40](https://hu.wikipedia.org/wiki/MÁV_V40_sorozat), [MÁV V63](https://hu.wikipedia.org/wiki/MÁV_V63_sorozat),
[Schweizer Krokodil](https://de.wikipedia.org/wiki/Schweizer_Krokodil),
[ÖBB 1016/1116](https://de.wikipedia.org/wiki/ÖBB_1016/1116), [SBB Re 460](https://de.wikipedia.org/wiki/SBB_Re_460),
[PRR class GG1](https://en.wikipedia.org/wiki/Pennsylvania_Railroad_class_GG1),
[SNCF TGV Sud-Est](https://en.wikipedia.org/wiki/SNCF_TGV_Sud-Est),
[Attelage Scharfenberg](https://fr.wikipedia.org/wiki/Attelage_Scharfenberg), [ICE 1](https://de.wikipedia.org/wiki/ICE_1),
[John Bull](https://en.wikipedia.org/wiki/John_Bull_(locomotive)), [Garratt](https://en.wikipedia.org/wiki/Garratt).
Others: the ASME GG1 landmark brochure (asme.org, landmark #83); Stummiforum on the Roco Taurus rail guard
([thread](https://www.stummiforum.de/t65391f29-Roco-Taurus-Chaos.html)); Bachmann Class 55 bogie spares
(bachmann-spares.co.uk, 32-525); Walthers SD40-2 frame parts; trainiax.net on the SW1500.
