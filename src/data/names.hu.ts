/**
 * The content's text in Hungarian, keyed by id: `content.ts` lays it over the data as the page
 * loads, when the language is Hungarian. Engines keep their proper names (`locomotives` has only
 * the line under the name); town names and names a player gave are never here. The wording follows
 * the UI workshop's mock wherever it has the term.
 */
export interface NamedText {
  name: string;
}
export interface FlavouredText extends NamedText {
  flavor: string;
}

export const HU_NAMES = {
  /** the line under a locomotive's name (`LocoDef.era`); the name is the engine's own */
  locomotives: {
    rocket: {
      era: '1829, a Rainhilli verseny győztese. A mozdony, amely bebizonyította a vasutat.',
    },
    mav490: {
      era: 'Az 1900-as évek elejének magyar 760 mm-es szertartályos mozdonya, 142 készült. A keskeny nyomtáv igáslova, és egy ma is jár a Gyermekvasúton.',
    },
    orenstein_koppel: {
      era: 'Orenstein & Koppel 0-4-0 tábori mozdony 600 mm-es pályára. 366-os gyári szám, 1899, húsz lóerő; a budapesti irodán át került egy nagymágócsi birtokra.',
    },
    bm50: { era: 'Az 1960-as évek magyar bányadízele. Ötven lóerő, lépésben.' },
    muki: { era: 'MD-40 bánya- és erdei dízel, a magyar keskeny nyomtáv kis mozdonya.' },
    c50: {
      era: 'Az 1950-es évek magyar 760 mm-es keskeny nyomtávú dízele, százszámra épült erdei és mezőgazdasági vasutaknak.',
    },
    adler: { era: '1835, Nürnberg és Fürth között. Németország első vasúti mozdonya.' },
    john_bull: { era: '1831, Camden & Amboy. Egy évszázadot futott, és ma is gőzt ad.' },
    mav375: {
      era: '1907-es magyar mellékvonali szertartályos mozdony. Százával épült, tucatnyi megmaradt.',
    },
    general: { era: '1855-ös Western & Atlantic 4-4-0, a Nagy Mozdonyüldözés sztárja.' },
    jupiter: {
      era: '1868-as Central Pacific 4-4-0; a Promontory Summitnél találkozott a Union Pacifickel.',
    },
    mav424: { era: '1924-es magyar vegyes forgalmú 4-8-0, a Bivaly. 1958-ig gyártották.' },
    k4s: { era: '1914-es Pennsylvania Railroad Pacific, negyven évig a gyorsvonatok alapgépe.' },
    drg01: { era: '1926-os német egységes gyorsvonati Pacific. Fekete, piros kerekek, 130 km/h.' },
    flying_scotsman: {
      era: '1923-as LNER A3. Az első gőzmozdony, amelynél hivatalosan 100 mérföld/órát mértek.',
    },
    daylight: {
      era: '1941-es Southern Pacific GS-4, a Coast Daylight narancs-piros áramvonalasa.',
    },
    mallard: { era: '1938-as LNER A4. 126 mérföld/óra: a valaha mért leggyorsabb gőzmozdony.' },
    big_boy: {
      era: '1941-es Union Pacific 4-8-8-4. Csuklós óriás, hogy tehervonatokat vonszoljon át a Wasatch-hegységen.',
    },
    sw1: { era: '1939-es hatszáz lóerős tolatómozdony. Egy nemzedék rendezőpályás kecskéje.' },
    class08: {
      era: '1952-es brit tolatómozdony, csaknem ezer készült. Lassú, fáradhatatlan, mindenütt ott van.',
    },
    m62: {
      era: '1965-ös szovjet tehervonati dízel, az egész keleti blokkba exportálták. Hangos és hűséges.',
    },
    f7: { era: '1949-es buldogorrú kabinos egység. Az amerikai vasút arca.' },
    sd40: {
      era: '1972-es hattengelyes univerzális mozdony. Csaknem négyezer készült, sok ma is jár.',
    },
    deltic: {
      era: '1961-es keleti parti gyorsvonati gép két ellendugattyús Napier-motorral. Visít.',
    },
    dda40x: { era: '1969-es Union Pacific kétmotoros óriás, a valaha épített legerősebb dízel.' },
    kando_v40: {
      era: '1932-es magyar fázisváltós villamos mozdony Kandó Kálmántól, az 50 Hz-es vontatás úttörője.',
    },
    v63: { era: '1975-ös magyar hattengelyes Gigant, a MÁV nehéz tehervonati villanymozdonya.' },
    crocodile: {
      era: '1919-es gotthardi tehervonati villanymozdony csuklós orrokkal. Összetéveszthetetlen.',
    },
    taurus: { era: '2000-es Siemens univerzális villanymozdony, amely induláskor skálát énekel.' },
    re460: { era: '1991-es svájci Lok 2000, a Bahn 2000 program reklámmozdonya.' },
    gg1: {
      era: '1934-es, Raymond Loewy formázta pennsylvaniai villanymozdony. Ötven év szolgálat.',
    },
    j94: {
      era: '1943, Hunslet Austerity tolatómozdony. Rendezőpálya, rövid utak, szerkocsi nélkül.',
    },
    black_five: { era: '1934, Stanier vegyes forgalmú 4-6-0. Bárhová elment, bármit elhúzott.' },
    nine_f: {
      era: '1954, öt kapcsolt tengelyes nehéz tehervonati gép. Az utolsó Nagy-Britanniában épült gőzmozdonysorozat.',
    },
    gmam: {
      era: '1953, Beyer-Garratt csuklós. Két gépegység, köztük felfüggesztett kazán: nagy erő könnyű síneken.',
    },
    tgv: {
      era: '1981, az első forgalomba állt nagysebességű szerelvény. Nagysebességű pálya és nagyfeszültségű vezeték kell, hogy kifusson.',
    },
    ice1: { era: '1991, Németország első nagysebességű szerelvénye. Többáramnemű motorkocsi.' },
    mk48: { era: 'Magyar keskeny nyomtávú dízel-hidraulikus mozdony.' },
  },
  wagons: {
    water_cart: { name: 'Fa vizeskocsi', era: 'Hordó egy kereten. Csöpög, de gurul.' },
    wood_hopper: {
      name: 'Fa garatos kocsi',
      era: 'Nyitott, nyitható fenekű garatos kocsi. Kő, szén, bármi.',
    },
    flatbed: { name: 'Pőrekocsi', era: 'Rakoncás pőrekocsi. Nappal rönk, éjjel széna.' },
    riveted_tank: {
      name: 'Szegecselt tartálykocsi',
      era: 'Kétdómos tartálykocsi. A közelében tilos a dohányzás.',
    },
    steel_hopper: { name: 'Acél garatos kocsi', era: 'Sajtolt acél garatos kocsi, két rekesszel.' },
    bolster_flat: {
      name: 'Forgózsámolyos pőrekocsi',
      era: 'Kétforgózsámolyos pőrekocsi hosszú rakományhoz.',
    },
    welded_tank: {
      name: 'Hegesztett tartálykocsi',
      era: 'Egyetlen hegesztett tartály, kétszer annyi folyadék.',
    },
    bathtub: { name: 'Kádas nyitott kocsi', era: 'Forgatva ürített nyitott kocsi szénvonatokhoz.' },
    bulkhead_flat: {
      name: 'Homlokfalas pőrekocsi',
      era: 'A homlokfalak a helyén tartják a rakományt.',
    },
    pressure_tank: {
      name: 'Nyomástartó tartálykocsi',
      era: 'Szigetelt nyomástartó edény hat tengelyen.',
    },
    dump_hopper: {
      name: 'Fenékürítős garatos kocsi',
      era: 'Sűrített levegős ajtók, másodpercek alatt ürül.',
    },
    heavy_flat: {
      name: 'Nehéz pőrekocsi',
      era: 'Mélyített rakfelületű kocsi a rakományokhoz, amelyeket más nem visz el.',
    },
    wooden_coach: {
      name: 'Fa személykocsi',
      era: 'Padok és egy kályha. Huzatos, de beviszi az embereket a városba.',
    },
    steel_coach: {
      name: 'Acél személykocsi',
      era: 'Szegecselt acél kocsiszekrény rendes ablakokkal.',
    },
    pullman: { name: 'Pullman-kocsi', era: 'Bársony, sárgaréz és étkezőszalon.' },
    brake_van: {
      name: 'Fékezőkocsi',
      era: 'Fékező kocsi a vonat végén. Veranda, kályha, kézifék.',
    },
    boxcar: {
      name: 'Deszkás fedett kocsi',
      era: 'Fedett teherkocsi. Szárazon tartja a gabonát, egyenesen a fát.',
    },
    coal_cart: {
      name: 'Szeneskocsi',
      era: 'Pótszéntartó gőzmozdonyhoz. Bármi más mögött holtsúly.',
    },
    fuel_cart: {
      name: 'Üzemanyagkocsi',
      era: 'Dízelhez kötött üzemanyagtartály. Bármi más mögött holtsúly.',
    },
    battery_cart: {
      name: 'Akkumulátorkocsi',
      era: 'Akkumulátorok, amelyekkel a villanymozdony a vezeték végén túl is fut. Bármi más mögött holtsúly.',
    },
    mine_tub: { name: 'Csille', era: 'Acélcsille négy kis keréken, kézzel billentik.' },
    narrow_tank: {
      name: 'Keskeny tartálykocsi',
      era: 'Rövid hordós tartálykocsi a keskeny nyomtávra.',
    },
    narrow_box: {
      name: 'Keskeny fedett kocsi',
      era: 'Fedett kocsi gabonának és árunak a keskeny nyomtávon.',
    },
    narrow_coach: { name: 'Keskeny személykocsi', era: 'Nyitott peronos személykocsi fapadokkal.' },
  },
  cargo: {
    water: { name: 'Víz' },
    wheat: { name: 'Búza' },
    stone: { name: 'Kő' },
    wood: { name: 'Fa' },
    coal: { name: 'Szén' },
    oil: { name: 'Olaj' },
    iron: { name: 'Vas' },
    passengers: { name: 'Utasok' },
    food: { name: 'Élelem' },
    iron_ore: { name: 'Vasérc' },
    crude: { name: 'Nyersolaj' },
    diesel: { name: 'Gázolaj' },
    sand: { name: 'Homok' },
    copper_ore: { name: 'Rézérc' },
    wire: { name: 'Huzal' },
  },
  stations: {
    farm: {
      name: 'Tanyai megálló',
      flavor:
        'Búzát termel. Vidd a fűtőházba, és a szélmalom élelmet őröl belőle a lakosoknak és a személyzetnek.',
    },
    lumber: { name: 'Fatelep', flavor: 'Fát vág építkezéshez és faszénhez.' },
    quarry: { name: 'Kőfejtő', flavor: 'Követ fejt építkezéshez és vashoz.' },
    pump: {
      name: 'Vízszivattyú',
      flavor:
        'Vizet szivattyúz a gőzmozdonyoknak és az üzemeknek. Teljesen feltölti a víztartályokat. Fűre vagy erdőbe kerül, közvetlenül a víz mellé.',
    },
    town: {
      name: 'Városháza',
      flavor:
        'A város központja. Lakóházakat és raktárt építve köré alapítod meg; az utasokhoz külön állomás kell.',
    },
    warehouse: {
      name: 'Raktár',
      flavor: 'Az áruját a város készletével osztja meg; városon kívül saját készlete van.',
    },
    depot: {
      name: 'Fűtőház',
      flavor:
        'Kétvágányú fűtőház négy kapuval. Az itt épült vonatok innen gördülnek ki, a kapunál kirakott áru pedig a készletbe kerül. Csak ezen át lehet bejutni.',
    },
    narrow_depot: {
      name: 'Keskeny fűtőház',
      flavor:
        'Keskeny nyomtávú fűtőház, egy átmenő vágánnyal. Keskeny vonatokat épít és tankol, amelyek 1×1-es íveken fordulnak: szűk helyekre, és a majdani bányákhoz.',
    },
    station: {
      name: 'Állomás',
      flavor:
        'Utasperonok a közeli lakóházaknak. Két állomást személykocsikkal összekötve embereket szállíthatsz a városok között.',
    },
    mine: { name: 'Vasbánya', flavor: 'Vasércet bányászik a köves talajból a vasműnek.' },
    sand_pit: {
      name: 'Homokbánya',
      flavor: 'Homokot termel a dűnékből és a partokról. A mozdonyok a sínre szórják a tapadásért.',
    },
    copper_mine: { name: 'Rézbánya', flavor: 'Rézércet bányászik a köves talajból a huzalműnek.' },
  },
  buildings: {
    windmill: {
      name: 'Szélmalom',
      flavor: 'Búzát őröl élelemmé. Egy búzából 5 élelem lesz, fejlesztésekkel 7, 9, 11, 13 és 15.',
    },
    kiln: {
      name: 'Faszénégető',
      flavor: 'Fából szenet éget a gőzmozdonyoknak és az erőműnek.',
    },
    grinder: { name: 'Kőőrlő', flavor: 'Követ zúz vassá sínhez, jelzőkhöz és gépekhez.' },
    refinery: {
      name: 'Olajfinomító',
      flavor: 'Szénből és vízből olajat készít a dízelmozdonyoknak.',
    },
    power_plant: {
      name: 'Erőmű',
      flavor: 'Üzemanyagot éget fával és vízzel, hogy áramot termeljen. Köss hozzá távvezetéket.',
    },
    substation: {
      name: 'Akkumulátor',
      flavor:
        'Az oszlophálózatról vételez, és hat csempén belül táplálja a vezetékeket. Ha túl sok vonat fut alatta, mind együtt lassul.',
    },
    hydro_plant: {
      name: 'Vízerőmű',
      flavor:
        'Turbinák a folyóban. Nem kell üzemanyag, és kétszer annyit ad, mint egy széntüzelésű erőmű, de csak ott, ahol víz van.',
    },
    bridge_wood: {
      name: 'Fahíd',
      flavor:
        'Fa rácsos tartók alkotnak összefüggő hidat az egyenes sínek alatt. Építs hídpályát vízre vagy terepmélyedésen át, majd fektess rá egyenes sínt: a sín a magasabb part szintjét tartja. A teherbírás 80%-a fölött a vonatok fél sebességgel mennek át; a túl nehéz vonatok más útvonalat keresnek.',
    },
    bridge_stone: {
      name: 'Kőhíd',
      flavor:
        'Falazott ívek alkotnak összefüggő hidat az egyenes sínek alatt. Építs hídpályát vízre vagy terepmélyedésen át, majd fektess rá egyenes sínt: a sín a magasabb part szintjét tartja. A teherbírás 80%-a fölött a vonatok fél sebességgel mennek át; a túl nehéz vonatok más útvonalat keresnek.',
    },
    colliery: {
      name: 'Szénbánya',
      flavor: 'Domboldalba mélyített aknaszáj: három szén minden bányafáért. Csak dombra.',
    },
    ironworks: {
      name: 'Vasmű',
      flavor: 'Vasércet olvaszt szénnel vassá. Sokkal jobb a hozama, mint a kőőrlőé.',
    },
    oil_derrick: {
      name: 'Olajkút',
      flavor: 'Nyersolajat szivattyúz a földből. Csak olajszivárgásra.',
    },
    diesel_refinery: { name: 'Finomító', flavor: 'Nyersolajból gázolajat párol a mozdonyoknak.' },
    wire_mill: { name: 'Huzalmű', flavor: 'Rézércből huzalt húz, ebből készül a villamosítás.' },
  },
  decor: {
    signal: {
      name: 'Szemafor',
      flavor:
        'Fő- és előjelző kar egy oszlopon. Vízszintes karral tilt, felemelt karral szabad. Sínre kerül.',
    },
    water_tower: {
      name: 'Víztorony',
      flavor:
        'Tárolt vizet ad a közeli állomásoknak és síneknek. A gőzvonatok felkeresik, mielőtt kifogynának. Szénrakodóval együtt teljes kiszolgálóhely.',
    },
    fuel_stop: {
      name: 'Szénrakodó',
      flavor:
        'Tárolt üzemanyagot ad a közeli állomásoknak és síneknek. A fogyó tartalékú vonatok felkeresnek egy elérhető szénrakodót; tegyél mellé víztornyot a teljes gőzös kiszolgáláshoz.',
    },
    power_line: {
      name: 'Távvezeték',
      flavor:
        'A sínek mentén viszi az áramot. Az oszlopokat egymás és az erőmű hatósugarán belül láncold.',
    },
    townhouse: {
      name: 'Lakóház',
      flavor:
        '20 lakos otthona. Minden korszak egy újabb szintet nyit 60, 140, 300, 520 és 800 lakosnak; fejlesztés alatt senki sem költözik be. A népesség a szabad férőhelyeknél megáll; az élelem a szélmalmokból jön.',
    },
  },
  banners: {
    steam_age: { name: 'A gőz kora' },
    diesel_era: { name: 'A dízel kora' },
    electric_line: { name: 'Villamos vonal' },
  },
  contractTemplates: {
    local: { name: 'Helyi fuvar' },
    bulk: { name: 'Tömeges rendelés' },
    rush: { name: 'Sürgős rendelés' },
    charter: { name: 'Nagy megbízás' },
    standing: { name: 'Állandó ellátás' },
  },
  contractRarities: {
    common: { name: 'Gyakori' },
    uncommon: { name: 'Nem gyakori' },
    rare: { name: 'Ritka' },
    epic: { name: 'Epikus' },
    legendary: { name: 'Legendás' },
  },
  trackPieces: {
    straight: { name: 'Egyenes' },
    curve: { name: 'Ív' },
    switch: { name: 'Váltó' },
    crossing: { name: 'Keresztezés' },
    bridge: { name: 'Híd' },
  },
  biomes: {
    plains: { name: 'Síkság', desc: 'Nyílt füves vidék. A tanyák jól teremnek.' },
    forest: {
      name: 'Erdő',
      desc: 'Sűrű erdő. A fatelepek többet vágnak; a sínnél irtás is kell, ez többe kerül.',
    },
    desert: {
      name: 'Sivatag',
      desc: 'Forró és száraz. A kőfejtők többet fejtenek, a szivattyúk kevés vizet találnak, a gőzmozdonyok többet isznak.',
    },
    taiga: {
      name: 'Tajga',
      desc: 'Hideg fenyveserdő. A fatelepek és a szivattyúk jól, a tanyák gyengén teljesítenek; a vonatok kicsit lassabbak.',
    },
    swamp: {
      name: 'Mocsár',
      desc: 'Vizes alföld. A szivattyúk bőven adnak; a sínhez töltés kell, a vonatok vánszorognak.',
    },
    ocean: { name: 'Óceán', desc: 'Nyílt víz itt-ott egy szigettel. A parton jók a szivattyúk.' },
    lake: { name: 'Tó', desc: 'Medencét kitöltő állóvíz. Jól merítenek a szivattyúk; csak híd.' },
    river: {
      name: 'Folyó',
      desc: 'A hegyektől tóig vagy tengerig futó víz. Jól merítenek a szivattyúk; híd vezet át rajta.',
    },
    beach: {
      name: 'Tengerpart',
      desc: 'Homok a tenger partján. A kőfejtők keveset találnak; a szivattyúk sós vizet kapnak.',
    },
    mountain: {
      name: 'Hegység',
      desc: 'Csupasz szikla, odafent hó és gleccserjég. A kőfejtők többet fejtenek; a sín drágább, a vonatok lassabban kapaszkodnak; a szivattyúk keveset találnak.',
    },
  },
} as const satisfies Record<string, Record<string, Partial<Record<string, string>>>>;

/** The Game tuning screen's rows, by rule key; a rule with no hint has none here either. */
export const HU_RULES: Record<string, { label: string; hint?: string }> = {
  startMoney: { label: 'Kezdő pénz' },
  startTickets: { label: 'Kezdő jegyek' },
  buildCostMul: { label: 'Építési költség x', hint: '0 = ingyenes építés' },
  upgradeTimeMul: {
    label: 'Fejlesztési idő x',
    hint: 'ennyi játékidőre zár be egy épület a fejlesztéshez; 0 = minden fejlesztés azonnali',
  },
  refundRate: { label: 'Visszatérítés aránya' },
  runningCostMul: { label: 'Üzemanyag-fogyasztás x' },
  wheatPerCrew: { label: 'Élelem fejenként hetente' },
  townStoreCap: { label: 'Városi készlet (városháza)' },
  buildReach: { label: 'Építés ennyi csempén belüli készletből', hint: 'csempe egy készlettől' },
  fuelReach: {
    label: 'Pálya menti tankolás ennyi csempén belüli készletből',
    hint: 'csempe egy készlettől, városon kívül',
  },
  warehouseCap: { label: 'Raktárkészlet szintenként' },
  depotCap: { label: 'Fűtőház készletének felső határa' },
  repeatCostStep: { label: 'Többletköltség ismételt építésenként' },
  inCabCost: { label: 'Vezetőállás-jelzés beszerelése' },
  trackCostScale: { label: 'Sínköltség szorzója' },
  startingResourceScale: { label: 'Kezdő nyersanyagok szorzója' },
  chunkCost: { label: 'Chunk ára (első gyűrű)' },
  chunkCostMul: { label: 'Chunk árának emelkedése gyűrűnként (×első)' },
  powerCap: { label: 'Áramakkumulátor' },
  startStock: { label: 'Kezdő áruk x' },
  spotPriceMul: { label: 'Azonnali ár x' },
  payoutMul: { label: 'Szerződés kifizetése x' },
  failPenaltyMul: { label: 'Mulasztási bírság x' },
  deadlineMul: { label: 'Határidő hossza x' },
  contractOfferCount: {
    label: 'Nyitott ajánlatok a kezdő chunkon',
    hint: 'egyben az ott tartható aktív szerződések száma; a vásárolt föld növeli; soha nem több a „Legtöbb nyitott ajánlat” értéknél, ezt a kezdőértéket is beleértve',
  },
  contractOffersPerChunk: {
    label: 'Nyitott ajánlat vásárolt chunkonként',
    hint: 'hozzáadódik az ajánlatokhoz és az aktív szerződésekhez, lefelé kerekítve; 0 = a föld nem ad többet',
  },
  contractOfferMax: {
    label: 'Legtöbb nyitott ajánlat',
    hint: 'az ajánlatok és az aktív szerződések felső határa, akármennyi a földed',
  },
  contractRefreshDays: { label: 'Ajánlatok frissítése (nap)' },
  trainSpeedMul: { label: 'Vonatsebesség x' },
  lineSpeedBranch: { label: 'Mellékvonal sebessége' },
  lineSpeedNarrow: { label: 'Keskeny vonal sebessége' },
  smallOnBigLine: {
    label: 'Kis vonat nagy vonalon',
    hint: 'többlet útvonalköltség vonalméretenként a vonat osztálya fölött; 0,25 = +25%',
  },
  narrowUnlocked: { label: 'Keskeny nyomtáv elérhető (0 vagy 1)' },
  lineAgeLocks: {
    label: 'Vonalak korszakonként nyílnak (0 vagy 1)',
    hint: 'Fővonal a Dízelkorszaktól, Törzsvonal a Villamos korszaktól; 0 minden vonalat azonnal megnyit',
  },
  loadRateMul: { label: 'Rakodási sebesség x' },
  productionMul: { label: 'Termelés x' },
  capacityMul: { label: 'Raktárkapacitás x' },
  daySeconds: { label: 'Nap hossza (valós mp, 1x sebességen)' },
  seasonDays: { label: 'Évszak hossza (nap)' },
  rainChanceMul: { label: 'Eső esélye x' },
  fogChanceMul: { label: 'Köd esélye x' },
  mapSize: { label: 'Térkép mérete (csempe)' },
  waterLevel: { label: 'Vízszint' },
  hillLevel: { label: 'Dombszint' },
  rockLevel: { label: 'Sziklaszint' },
  forestDensity: { label: 'Erdőküszöb', hint: 'alacsonyabb = több erdő' },
  trackWearMul: {
    label: 'Sínkopás x',
    hint: 'a vonatok és az idő okozta kopás szorzója; 0 = nincs kopás',
  },
  trackHpNarrow: { label: 'Keskeny vonal elemének élete' },
  trackHpBranch: { label: 'Mellékvonal elemének élete' },
  trackHpMain: { label: 'Fővonal elemének élete' },
  trackHpTrunk: { label: 'Törzsvonal elemének élete' },
  trackWearNarrow: { label: 'Keskeny vonal kopása x' },
  trackWearBranch: { label: 'Mellékvonal kopása x' },
  trackWearMain: { label: 'Fővonal kopása x' },
  trackWearTrunk: { label: 'Törzsvonal kopása x' },
  trackWearPerTonne: {
    label: 'Kopás a vonat tonnánként',
    hint: 'ennyi életet visz el egy vonat a tömege minden tonnája után, a vonal szorzója előtt',
  },
  trackTimeWear: {
    label: 'Kopás naponta (az elem életének része)',
    hint: 'minden elem naponta ennyit veszít, vonattal vagy anélkül',
  },
  trackDegradedAt: { label: 'Leromlott ez alatt (az élet része)' },
  trackCloseAt: {
    label: 'Leromlás közelében ez alatt (az élet része)',
    hint: 'a karbantartó vonatok innentől gondoznak egy elemet',
  },
  trackDegradedSpeed: { label: 'Leromlott sín sebessége x' },
  trackDegradedWear: { label: 'Leromlott sín kopása x' },
  trackCrawlSpeed: {
    label: 'Kúszás sebessége használhatatlan sínen',
    hint: 'csempe másodpercenként',
  },
  trackRepairPrice: {
    label: 'Vonatos javítás ára (az építési költség része)',
    hint: 'az elem teljes életének javításáért',
  },
  trackRepairSeconds: {
    label: 'Vonatos javítás ideje (játékmásodperc)',
    hint: 'az elem teljes életének javításáért',
  },
  trackHandRepairMul: {
    label: 'Kézi javítás ára x',
    hint: 'a vonatos javítás árának többszöröse',
  },
};
/** The tuning groups, by the English name `RULE_META` keeps them under. */
export const HU_RULE_GROUPS: Record<string, string> = {
  Start: 'Kezdés',
  Economy: 'Gazdaság',
  Contracts: 'Szerződések',
  'Trains & stations': 'Vonatok és állomások',
  'Time & weather': 'Idő és időjárás',
  Map: 'Térkép',
  'Track wear': 'Sínkopás',
};

/** What each save upgrade filled in, by the format version it upgrades from (`MIGRATIONS`). */
export const HU_MIGRATIONS: Record<number, string> = {
  1: 'a szolgáltatások és jelzők listája üresen indult',
  2: 'a világ leírása a magból, alapértelmezett térképparaméterekkel újjáépítve',
  3: 'az üzemek listája üresen indult',
  4: 'a saját chunkok az elért szintből újjáépítve: a kezdő chunktól annyi gyűrűn belül minden chunk',
  5: 'az 1. nap évszaka tavasz',
  6: 'a városok üresen indultak, az állomások 0 forgatással, az útvonalmódok az új nevekre átírva, a kezdőhelyre fűtőház került (betöltéskor érvényesül)',
  7: 'a kereskedelmi pult üresen nyílt: nincs állandó ügylet, az üzemanyag alapáron; az útvonalmódok az új nevekre átírva',
  8: 'minden sínelem széles sínnek számít; a feszültség alatti sínekre felsővezeték került (betöltéskor érvényesül); a régi lakóházak 1. szintű, hatlakosú lakóházak lettek; a hírnév megszűnt: az elért szint lett a korszak (legfeljebb a Villamos korszak), az összes bevétel 0-ról indul, a termelési lánc egyszerű; a szerződések gyakoriak, vonat nélkül; az automatikus elfogadás ritkaságonkénti beállítás lett',
  9: 'a járműparkban lévő minden modell receptje megadva; a mozdonymódok az alapszabály szerint (az első egység vezet, a vezérlési osztályába tartozók többes vezérlésben, a többiek kettős vontatásban; betöltéskor érvényesül); az akkumulátorkocsik üresen indulnak',
  10: 'a szerződésajánlatok lassabban jönnek (egyszerre kettő, hatnaponta), hacsak kézzel nincs hangolva; a nagysebességű küldetés befejezetlenül indul',
  11: 'heti élelmezés, üzemfejlesztések, önálló hídpályák és utasállomások; a meglévő városházák megtartják a városukat',
  12: "a széles nyomtávú ívek és váltók egycsempések voltak: keskeny nyomtávúak lettek, és a hozzájuk futó vonalakat 2×2-es elemekkel újra kell fektetni. A Stephenson's Rocket és az Mk48 mostantól keskeny nyomtávú: hívd vissza a vonataikat, és állítsd össze újra a járműparkba került keskeny kocsikkal",
  13: 'a vonatok útvonal nélkül állnak és keresnek egyet, ahogy eddig minden betöltés után: nincs félreállási útvonaluk, újra kérhetők, hogy hátráljanak, nincs kizárt megálló és kiszolgálóhely, és azonnal üzemanyagot vagy vizet keresnek; mostantól a mentés megőrzi, mit csinált a vonat',
  14: 'semmi sem állt fejlesztés alatt: a fejlesztés mostantól játékidőbe telik, addig zárva tartja az épületet, és a mentés megőrzi a folyamatban lévőket',
  15: 'minden üzem úgy néz, ahogy rajzolták (0 forgatás); mostantól az állomások, üzemek és házak négy irány egyikében állnak, és a mentés megőrzi ezt',
  16: 'egyik vonat sem félreállás közben mentődött: a félreálló vonat a beállás helyén vár, a mozgó újratervez, a várakozó újra néz, az útban álló tétlen vonat és a beszorulás azonnal újra próbálkozik, a megjegyzések üresek; mostantól a mentés mindezt megőrzi, és minden vonat ott folytatja, ahol tartott',
  17: 'a Termelés és a Gyűjtés egy Teherfuvar móddá vált: az ilyen vonatok mostantól Teherfuvarként oda mennek, ahol a legtöbb áru áll, termelőhöz vagy raktárhoz, a termelők áruját raktárba vagy fűtőházba, a raktárakét fűtőházba viszik; mostantól a mentés megőrzi, hol rakott le árut a vonat',
  18: 'a még nem tárolt talajú generált térkép talaja a szokásos módon készül el, chunkonként tárolódik, és a mentés azonnal íródik (betöltéskor érvényesül); mostantól a mentés minden chunk talaját megőrzi, így a térképgenerálás változása csak az új földekre hat',
  19: 'nem épült út: az útlista üresen indult',
  20: 'a közös készlet a kezdő fűtőházba került; minden raktár megtartja a saját áruját',
  21: 'a hat vonaltípus váltotta fel a sínosztályokat: a széles és a nagysebességű sín Mellékvonal lett, az átmenetek Mellékvonal-egyenesek',
  22: 'a vonatok színkódot kaptak: a régebbi mentések minden vonata az első színt kapja',
  23: 'a sínek élettel indulnak: minden elem teljes épségű, a kopásról szóló figyelmeztetések még nem jelentek meg',
};
