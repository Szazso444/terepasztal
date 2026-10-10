# UI-mintatervek — 2026-10-06

Három alternatív játék közbeni látványterv a készülő illusztrált vasúti világhoz. Koncepcióképek, nem a futó játék képernyőmentései; a hátterük is generált. A feliratok angolul szerepelnek a képeken. A mintaszámok nem valós játékállapotból származnak.

## 01 — Vasúti atlasz

`01-railway-atlas.png`

Világos papír, erdőzöld szöveg, finom rézszínű keretek, szerif címsorok és festett tárgyikonok. Az illusztrált tájhoz illő, könyvszerű karakter. Jó kiindulás, ha a világ mesélő, felfedezős hangulatát szeretnénk erősíteni. A papír textúrája implementáláskor maradjon alig látható, hogy ne zavarja a kis számokat.

## 02 — Állomási zománctáblák

`02-station-enamel.png`

Mélyzöld zománcfelületek, elefántcsont betétek, vasúti táblákra emlékeztető tipográfia és műszerek. Erősebb vasúti identitás, kontrasztos kezelőszervek. A sötét felületek tömegét és a díszítést vissza kell fogni, hogy a térkép maradjon a főszereplő.

## 03 — Kortárs terepasztal

`03-contemporary-diorama.png`

Melegfehér kártyák, zsályazöld kijelölés, lágy sarkok és nagyobb térközök. A legnyugodtabb, legkönnyebben bővíthető irány; a részletes asseteket hagyja érvényesülni. A vasúti karaktert inkább a tárgyikonok és az útvonalrajz adják. A későbbi Magnetic/Hyper korszakhoz is jól illeszthető.

## Közös funkcionális alap

- Fent a globális készlet, pénz, korszak és idővezérlés.
- Bal oldalt rövid aktuális cél; lent kis áttekintő térkép.
- Jobb oldalt a kijelölt vonat állapota, rakománya, üzemanyaga és útvonala.
- Alul csoportosított építési eszköztár, egyértelmű aktív eszközzel.
- Szöveggel és ikonnal is jelölt figyelmeztetés.

Az új UI-ban a készlet és a pénz külön fogalom marad: építéshez nyersanyag kell, a pénz nem helyettesíti azt. A helyi raktárkészletet a globális készlettől elkülönítve kell majd mutatni a részletes állomáspanelen.

## Javasolt továbbfejlesztés

Kiindulásnak a Vasúti atlasz karaktere a Kortárs terepasztal térközeivel és egyszerűségével. A végleges változatban a számlálók és kezelőszervek valódi DOM-elemek legyenek, a festett ikonok külön assetek. A koncepcióképekből nem érdemes teljes panelhátteret kivágni. A 1280×720-as minimumfelbontást, hosszabb magyar feliratokat, hover/focus/disabled állapotokat és a teljes nyersanyaglistát külön implementációs körben kell ellenőrizni.

## Források és reprodukálás

- Képi referencia: `../base-v1/age-progression-board-v1.png`.
- Játékmenet és jelenlegi UI: `README.md`, `src/ui/hud.ts`, `src/ui/style.css`.
- Korszakok art directionje: `docs/superpowers/specs/2026-10-02-building-eras-art-package-design.md`.
- A teljes promptok: `prompts.json`; beépített image_gen eszköz.

A futó játék kódja és atlaszai nem változtak.

## A képek értelmezési korlátai

A generált feliratok és mintaszámok vizuális helykitöltők. Az atlaszos kép például alagút-eszközt és készletváltozási rátákat is megjelenít: ezek látványtervi kiegészítések, nem új funkciókra tett javaslatok vagy meglévő funkciók igazolásai. A végleges eszközlista a játék adatfájljaiból származzon. A háttér nem hitelesíti az assetek vetületét vagy a pálya geometriáját.
