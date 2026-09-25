# Image brief for Astra

Paste everything below the line into Astra. It is written to Astra and stands on its own.

The images feed `run.py`: each one goes to `input/<file>` and its row in `assets.csv` (the roster rows there are
commented out with `#`; remove the `#` once the image is in `input/`).

---

## What these images are for

You are making reference images for an image-to-3D model (Pixal3D / TRELLIS.2 in ComfyUI). It rebuilds one 3D model
from each image. The models are then rendered as small isometric sprites for a train game, 60-130 pixels long, seen
from above at 30 degrees. So the image must show one complete object that a machine can reconstruct, and its colours
and shapes must still read when shrunk to a few dozen pixels.

## How to work through this

- Go through the tables in order, one image at a time, and name each file exactly as listed.
- Start with `flying_scotsman.png`, `sd40.png`, `bogie_emd.png` and `station_2.png`, and stop for approval. Once they are
  approved, use them as the reference for camera angle, distance, lighting, background and finish for everything else,
  so the whole set looks like one photo session.
- Draw each prototype as it really is. If you are unsure what a prototype looks like, say so rather than inventing one.
- Report in one line per image: file name, subject, and anything you had to leave out or guess.
- Never break a rule below to make an image look nicer; the reconstruction depends on them.

## Rules for every image

**Subject**
- Exactly one object, entire and uncropped, centred, filling about 80% of the frame with a clear margin on all sides.
- A clean, accurate scale-model look (museum display model, die-cast): true proportions and the prototype's livery,
  crisp edges, matte paint, broad clear areas of colour. No weathering, rust streaks, dirt, grime or chipped paint.
- No legible lettering, numbers, logos or nameplates. Keep the livery colours and lining; the game carries no baked
  text.
- Windows are dark tinted glass, not see-through. No interior visible through them.
- No smoke, steam, sparks, exhaust or motion blur: the 3D model turns them into solid lumps.

**Camera**
- Three-quarter front view: the front of the object points to the **right** of the image and slightly towards the
  camera, about 35 degrees round from a pure side view. One long side and the front end are both visible.
- Camera 20-30 degrees above the object, looking slightly down. Long lens / near-orthographic: no wide-angle
  distortion, verticals stay vertical.
- The object is level and straight: no curve, no tilt, no Dutch angle.
- Use the same camera angle, distance feel and lighting for every image in the set.

**Background and light**
- Plain seamless light-grey or white studio background. No track, rails, sleepers, platform, ground, grass, sky,
  buildings, people or props. The object stands on nothing.
- Soft, even, overcast studio light from the upper left. No hard cast shadows, no strong reflections, no glare, no
  rim lighting, no night or sunset.

**Output**
- Square PNG, 1024 x 1024 or larger, sRGB.
- File name exactly as listed below.

## Prompt template

Fill in `<subject>` and `<notes>` from the tables:

> Studio product photo of a highly detailed museum scale model of `<subject>`. `<notes>`. Three-quarter front view,
> front pointing to the right, camera 25 degrees above, long lens, entire model in frame with margin, plain light-grey
> seamless background, soft even light from the upper left, matte paint, clean, no weathering, no text or numbers, no
> track, no ground, no smoke, no people.

## Locomotives

Show the whole locomotive as listed, wheels and all. "With tender" means engine and tender coupled, straight, both
complete, in one image. Articulated engines are shown whole. The wheels stay in the picture even though the game draws
its own running gear: the pipeline cuts them off after the 3D step.

| File | Subject | Notes |
|---|---|---|
| `rocket.png` | Stephenson's Rocket, 1829 | With its tender. Yellow, tall white chimney, inclined cylinders |
| `adler.png` | Adler, 1835 German locomotive | With its tender. Green, tall chimney |
| `john_bull.png` | John Bull, 1831 Camden & Amboy locomotive | With its tender. Black, wooden pilot at the front |
| `mav375.png` | MÁV class 375 Hungarian tank engine | Engine only, no tender. Black |
| `general.png` | The General, 1855 Western & Atlantic 4-4-0 | Engine only, no tender. Red and dark green, brass, big balloon stack |
| `jupiter.png` | Jupiter, 1868 Central Pacific 4-4-0 | Engine only, no tender. Blue, red and brass, balloon stack |
| `j94.png` | Hunslet Austerity J94 saddle tank | Engine only. Black |
| `mav424.png` | MÁV class 424 Bivaly 4-8-0 | With tender. Black, red wheels |
| `k4s.png` | Pennsylvania Railroad K4s Pacific | With tender. Dark green-black |
| `drg01.png` | DRG class 01 Pacific | With tender. Black upper body, red wheels and frames |
| `flying_scotsman.png` | LNER A3 Flying Scotsman | With tender. Apple green, black frames |
| `black_five.png` | LMS Stanier Black Five 4-6-0 | With tender. Black |
| `nine_f.png` | BR Standard class 9F 2-10-0 | With tender. Black |
| `daylight.png` | Southern Pacific GS-4 4449 Daylight | With tender. Orange, red and black streamlined livery |
| `mallard.png` | LNER A4 Mallard | With tender. Garter blue streamlined casing, red wheels |
| `big_boy.png` | Union Pacific Big Boy 4-8-8-4 | Engine only, **no tender**. Black |
| `gmam.png` | South African GMAM Beyer-Garratt | Whole articulated engine: front water unit, boiler, rear coal unit. Green |
| `sw1.png` | EMD SW1 switcher | Black |
| `class08.png` | BR Class 08 shunter | Green |
| `m62.png` | M62 Soviet diesel (MÁV M62) | Green |
| `f7.png` | EMD F7A cab unit | Red and silver warbonnet-style livery |
| `sd40.png` | EMD SD40-2 | Black |
| `deltic.png` | BR Class 55 Deltic | Two-tone blue |
| `dda40x.png` | Union Pacific DDA40X Centennial | Armour yellow and grey |
| `kando_v40.png` | MÁV Kandó V40 electric | Green, side rods |
| `v63.png` | MÁV V63 Gigant electric | Red |
| `crocodile.png` | SBB Ce 6/8 Crocodile | Brown, both long snouts and the centre cab, whole |
| `taurus.png` | ÖBB 1116 Taurus | Red |
| `re460.png` | SBB Re 460 | Red |
| `gg1.png` | Pennsylvania Railroad GG1 | Dark green, gold pinstripes |
| `tgv.png` | TGV Sud-Est power car | Orange and white, one power car only |
| `ice1.png` | ICE 1 power car | White with red stripe, one power car only |

## Wagons

These are the game's own designs, not exact prototypes. Keep them plain and typical of the era named.

| File | Subject | Notes |
|---|---|---|
| `water_cart.png` | Early wooden four-wheel wagon carrying a big water barrel | Natural wood |
| `wood_hopper.png` | Early wooden four-wheel open hopper wagon | Natural wood |
| `flatbed.png` | Early wooden four-wheel flat wagon with stakes | Natural wood, empty |
| `boxcar.png` | Wooden plank four-wheel covered goods wagon | Natural wood |
| `wooden_coach.png` | Early four-wheel wooden passenger coach | Varnished wood |
| `brake_van.png` | Four-wheel brake van with a veranda | Brown |
| `coal_cart.png` | Small four-wheel coal wagon | Black, empty |
| `riveted_tank.png` | Riveted two-dome tank wagon | Black |
| `steel_hopper.png` | Pressed-steel twin-bay hopper wagon | Grey steel |
| `bolster_flat.png` | Steel twin-bolster flat wagon | Grey steel, empty |
| `welded_tank.png` | Welded single-barrel tank wagon | Grey steel |
| `bathtub.png` | Rotary-dump bathtub coal gondola | Black |
| `bulkhead_flat.png` | Bulkhead flat wagon with end walls | Grey steel, empty |
| `pressure_tank.png` | Insulated pressure tank wagon on six axles | Grey steel |
| `dump_hopper.png` | Air-operated bottom-dump hopper wagon | Grey steel |
| `heavy_flat.png` | Depressed-centre heavy flat wagon | Grey steel, empty |
| `fuel_cart.png` | Small fuel tank wagon | Red |
| `battery_cart.png` | Small covered wagon carrying battery cells | Blue |
| `steel_coach.png` | Riveted steel bogie passenger coach, about 20 m | Grey steel |
| `pullman.png` | Pullman dining car | Black and cream, brass details |

## Bogies

The running gear the game draws under every medium and large vehicle, one family per style so the whole fleet
matches. The bogie alone, as if lifted out from under the vehicle: no body, no track. Same camera as the rest, but 30
degrees above so the frame and wheels read; either end points right.

| File | Style | Subject |
|---|---|---|
| `bogie_steam_engine.png` | steam | Steam driving-wheel set: two large spoked driving wheels joined by a coupling rod, with the cylinder and valve gear in front, outside frame. Black, red wheel rims |
| `bogie_steam.png` | steam | Plain two-axle steam-era tender bogie: plate frame, small spoked wheels, leaf springs. Black |
| `engine_unit_steam.png` | steam | Big Boy engine unit: four coupled driving wheels with rods, cylinder in front, frame. Black |
| `bogie_emd.png` | emd | EMD Blomberg B two-axle locomotive truck. Dark grey |
| `bogie3_emd.png` | emd | EMD Flexicoil C three-axle locomotive truck. Dark grey |
| `bogie_europe.png` | europe | Modern European two-axle locomotive bogie with coil springs. Dark grey |
| `bogie3_europe.png` | europe | European three-axle locomotive bogie (M62 / V63 type). Dark grey |
| `bogie_classic.png` | classic | 1920s-30s electric two-axle bogie, outside frame, spoked wheels. Black |
| `bogie3_classic.png` | classic | 1920s-30s electric three-axle truck, outside frame, spoked wheels. Black |
| `bogie3_classic_engine.png` | classic | Crocodile rod drive: three spoked wheels with a jackshaft and coupling rods. Black |
| `bogie_coach.png` | coach | Two-axle passenger coach bogie with leaf springs. Black |

## Buildings

The long side faces the camera, the whole building including the roof is visible, 30 degrees above. No platform
edge, track, fence, people or ground clutter.

| File | Subject |
|---|---|
| `station_1.png` | Small country halt: single-storey brick shelter with a small canopy |
| `station_2.png` | Village station: single-storey stone building with a canopy |
| `station_3.png` | Town station: two-storey station building with a canopy and chimneys |
| `depot.png` | Two-road brick engine shed with a slate roof and open doors at both ends |

## Before you hand an image over

- Whole object visible, nothing cropped, nothing else in the frame?
- Front pointing right, three-quarter view from 20-30 degrees above, same angle as the rest of the set?
- Plain background, no track or ground, no text, no smoke?
- File name exactly as in the table?
