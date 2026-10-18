  // ---------- v9: the level steps on the mountain's right-hand faces (the author, 16 October: "the right side of the
  // mountain still runs together very much: you cannot tell where the steps are"; the right side is the faces turned to
  // the lower right and the upper right of the screen, the author’s south-east and north-east). There the stacked levels are one
  // slope that faces away from the light from the upper left, so the light that tells a tread from its riser on the faces
  // turned left is gone; each level step is painted on them instead, by the level edge it belongs to (the edge between
  // levels k and k + 1 lies at height k + 0.5, where the stacked slope is steepest): the riser a value step darker, its
  // lip lit, a shadow at its foot, the tread between two risers back toward the plateau's light. Its edges wander a little
  // (the point is moved up to about 0.16 tile along the ground before its level is read), and their widths are measured on
  // screen, so they keep their size whichever way the face turns. Only where the slope's downhill turns to the right of
  // the screen (rightness: 0.71 facing SE or NE, 1 facing E, 0 facing S or N, below 0 facing left); the faces turned
  // left and everything off the mountain stay as they were, pixel for pixel. Game v2's steps are crisp ledges of its
  // rock: the riser filled with the flank's crag rock, cooler in its shade, its top edge lit, the tread just above it
  // clear of rock, the rock thinning along the edge into rubble and grass in places. Smooth v2's are soft lips over
  // grassy risers with a few outcrops.
  // In: the point, its height and slope (gx, gy: world px per tile), game. Out: RS_W how much of a right-hand face the
  // point is on (0: none, and nothing else is set), RS_K the step's light (multiplies the flank's shade), RS_RISE how
  // much of a riser it is, RS_LIP and RS_FOOT its lip's light and its foot's shadow (0 to 1), RS_CLR how clear of rock
  // the tread just above the lip is, RS_RB how much of the riser's rock is left along the edge here (0 to 1).
  // RSP per relief: t0 the rightness the marks begin at (full 0.35 past it); tread, riser, lip, foot their strength; eL
  // and eF where the lip and the foot lie (levels above the edge) and ev how much that wanders; sT, sR the lip's width
  // (screen px at zoom 1) on its tread's side and its riser's, sF, sFr the foot's below and above it, rw how soft the
  // riser's edges are; rock how much more crag rock a riser shows, rbk how much of it thins out along the edge in places;
  // clr how much rock the tread keeps off just above the lip, sC how far (screen px at zoom 1); cool how much cooler a
  // riser is; wa, wb the warp's two octaves (tiles); lb how much the lip is broken along its length, lbk how much a crag
  // breaks it
  const RSP = {
    game: { t0: 0.18, tread: 0.18, riser: 0.22, lip: 0.3, foot: 0.2, eL: 0.24, eF: -0.24, sT: 0.6, sR: 1, sF: 2.2, sFr: 1.2, rock: 0.9, wa: 0.24, wb: 0.08, ev: 0.16, lb: 0.7, rw: 0.7, clr: 0.8, sC: 2.5, cool: 1, lbk: 0, rbk: 0.55 },
    smooth: { t0: 0.18, tread: 0.16, riser: 0.22, lip: 0.26, foot: 0.16, eL: 0.24, eF: -0.26, sT: 2, sR: 1, sF: 3.4, sFr: 2, rock: 0.15, wa: 0.24, wb: 0.06, ev: 0.12, lb: 0.35, rw: 1.4, clr: 0.4, sC: 2.5, cool: 1, lbk: 0.7, rbk: 0.8 },
  };
  let RS_W = 0, RS_K = 1, RS_RISE = 0, RS_LIP = 0, RS_FOOT = 0, RS_CLR = 0, RS_RB = 1;
  function rightSteps(tx, ty, gx, gy, levels, game) {
    RS_W = 0; RS_K = 1; RS_RISE = 0; RS_LIP = 0; RS_FOOT = 0; RS_CLR = 0; RS_RB = 1;
    const gl = Math.sqrt(gx * gx + gy * gy);
    if (gl < 0.4) return;
    const P = game ? RSP.game : RSP.smooth, rr = ((gy - gx) / gl) * Math.SQRT1_2;
    if (rr <= P.t0) return;
    const w = sstep((rr - P.t0) / 0.35) * sstep((levels - 0.08) / 0.25);
    if (w <= 0) return;
    RS_W = w;
    // the level edge nearest the point, read a little off it (two octaves, up to 0.15 tile), and how far above that
    // edge it is (levels)
    const n1 = vnoise(tx * 1.3 + 17, ty * 1.3 + 29), n2 = vnoise(tx * 1.3 + 43, ty * 1.3 + 11), n3 = vnoise(tx * 3.7 + 5, ty * 3.7 + 61);
    const px = tx + (n1 - 0.5) * P.wa + (n3 - 0.5) * P.wb, py = ty + (n2 - 0.5) * P.wa - (n3 - 0.5) * P.wb;
    const zw = heightAt(px, py) / LEVEL, e = zw - Math.floor(zw) - 0.5;
    // along the edge the riser is a little taller or shorter, and its lip is lit more or less (rubble and grass break
    // it in places)
    const nl = vnoise(tx * 2.1 + 71, ty * 2.1 + 5), eL = P.eL + (n2 - 0.5) * P.ev, eF = P.eF - (n1 - 0.5) * P.ev;
    // levels per screen px (zoom 1) along the slope here (the surface's gradient through the iso projection)
    const den = 32 - gx - gy, q = Math.hypot((gx - gy) / 2, gx + gy) / ((den > 4 ? den : 4) * LEVEL);
    const qq = q > 0.004 ? q : 0.004;
    const dL = (e - eL) / qq, dF = (e - eF) / qq; // screen px above the lip and above the foot
    const rise = sstep((dF + 0.5 * P.rw) / P.rw) * (1 - sstep((dL + 0.5 * P.rw) / P.rw));
    const lip = dL >= 0 ? Math.exp(-(dL * dL) / (P.sT * P.sT)) : Math.exp(-(dL * dL) / (P.sR * P.sR));
    const ft = dF <= 0 ? Math.exp(-(dF * dF) / (P.sF * P.sF)) : Math.exp(-(dF * dF) / (P.sFr * P.sFr));
    RS_RISE = rise * w; RS_LIP = lip * w * (1 - P.lb * (1 - sstep((nl - 0.25) / 0.35))); RS_FOOT = ft * w;
    // the tread just above the lip keeps clear of crag rock, so the riser's rock ends at its lip
    RS_CLR = w * sstep((dL + 0.5) / 1) * (dL > 0 ? Math.exp(-(dL * dL) / (P.sC * P.sC)) : 1);
    // and along the edge the riser's rock thins out in places into rubble and grass
    RS_RB = 1 - P.rbk * (1 - sstep((vnoise(tx * 0.9 + 23, ty * 0.9 + 37) - 0.3) / 0.35));
    RS_K = 1 + w * (P.tread * (1 - rise) * (1 - ft) - P.riser * rise);
  }
  function mountainAt(tx, ty, z, gx, gy, levels, wx, wyg, rocky, mtile) {
    // (fix round 2, the critic: at zoom 4 the rock met the top in a straight line along each level edge) where the
    // flank begins wanders with a noise, so the top's ground runs out into the flank's rock in tongues, not on a rule
    const fln = (vnoise(tx * 3.3 + 41, ty * 3.3 + 7) - 0.5) * 0.7 + NZ2Y * 0.3;
    const zl = z / LEVEL, fl = sstep((levels - 0.2 + fln) / 0.55);
    // the break of slope (convex) and the foot (concave): the surface's curvature over about 0.3 tile, in levels/tile²
    const kc = 0.3, cv = FLAT_P ? 0 : (heightAt(tx + kc, ty) + heightAt(tx - kc, ty) + heightAt(tx, ty + kc) + heightAt(tx, ty - kc) - 4 * z) / (kc * kc * LEVEL);
    const brk = sstep((-cv - 1) / 3), foot = sstep((cv - 1) / 3);
    // the top is lightest (art direction: one upper-left light, top faces lightest). Fix round 1 (the critic: at zoom 1
    // the mountain read as a flat grey field, its flank the plateau's own value): the flank is one clear value step
    // darker than the plateau facing SE (away from the light), half a step facing SW or NE, a little facing NW (into the
    // light), and darkens on toward its foot, so the mass stands raised above the forest. A lip with no snow on it catches
    // the light; under a snow edge (SB_*) the break of slope is a band of darker crags in the snow's short cast shadow.
    const gl = Math.hypot(gx, gy) || 1, fse = gx < 0 ? -gx / gl : 0, fnw = gx > 0 ? gx / gl : 0, fsw = gy < 0 ? -gy / gl : 0, fne = gy > 0 ? gy / gl : 0;
    let face = MF_SE * fse + MF_SW * (fsw + fne) + 0.04 * fnw; if (face > MF_SE) face = MF_SE;
    const dep = sstep((MTN_TOP - 0.3 - zl) / 2.6);
    const sb = SB_ON > 0 && SB_DROP > -0.5, band = sb && SB_DROP > 0 ? SB_ON * sstep((SB_BELOW + 0.02) / 0.06) * (1 - sstep((SB_BELOW - 0.3) / 0.2)) : 0;
    MS_SHADE = 1 - fl * (face + MF_FOOT * dep) + 0.08 * brk * (sb ? 1 - SB_ON : 1);
    MS_FL = fl;
    MS_EXTRA = 1 - 0.14 * foot;
    MS_STEEP = 0;
    rightSteps(tx, ty, gx, gy, levels, rocky === 1); // (v9: the level steps on the right-hand faces)
    let r = RB[0], g = RB[1], b = RB[2];
    // the flank's own ground: the mountain's alpine ground, a little darker on the slope
    // (and all over a mountain tile whose own ground is the forest's or the meadow's, so no forest floor shows through)
    const own = RB_M === M.ROCKMIX || RB_M === M.ALPINE, gw = own ? 0 : mtile ? 0.92 : Math.max(fl, foot * 0.8) * 0.92;
    if (gw > 0.01) { sampleMat(M.ALPINE, tx, ty, wx, wyg); const d = 1 - 0.06 * fl; r += (V[0] * d - r) * gw; g += (V[1] * d - g) * gw; b += (V[2] * d - b) * gw; }
    // scree at the foot: Codex's rock at half size, in lobes that spread out onto the ground below
    const lob = 0.6 * vnoise(tx * 3.1 + 7, ty * 3.1 + 3) + 0.4 * vnoise(tx * 7.7 + 1, ty * 7.7 + 5);
    const sc = foot * sstep((lob - 0.72 + 0.5 * foot) / 0.07);
    if (sc > 0.01) { sampleMat(M.HIGHROCK, tx, ty, wx * 2, wyg * 2); const d = 0.84; r += (V[0] * d - r) * sc * 0.9; g += (V[1] * d - g) * sc * 0.9; b += (V[2] * d - b) * sc * 0.9; MS_STEEP = sc; }
    // the outcrops: most where the flank is steepest, none in the scree, a few crags along the break of slope
    // (round 3: how far the crags reach into the foot wanders along the bank, so where the foot stops them is no line ruled
    // along a straight bank; and their lower rims come in short lengths, so no dark line runs on along a contour)
    const fj = foot > 0 ? 0.3 + 0.7 * sstep((vnoise(tx * 3.3 + 5, ty * 3.3 + 1) - 0.3) / 0.4) : 1;
    let want = rocky * fl * (0.48 + 0.32 * sstep((levels - 0.7) / 0.8)) * (1 - 0.85 * foot * fj) + brk * (0.36 + 0.24 * rocky) + 0.42 * band;
    if (RS_W > 0) { const P = rocky === 1 ? RSP.game : RSP.smooth; want += P.rock * RS_RISE * RS_RB - P.clr * RS_CLR; } // (v9: a right-hand riser's own rock, none just above its lip)
    if (want > 0.85) want = 0.85;
    let rkS = 0;
    if (want > 0.02) {
      const zw = zl + 0.65 * (vnoise(tx * 3.1 + 7, ty * 3.1 + 2) - 0.5); // (round 3: the warped level, see crag)
      const rk = crag(tx, ty, zw, want), e = 0.035;
      rkS = rk;
      // the rock just up the screen (its shadow falls here), just below it and to either side (its rims)
      const up = crag(tx - 0.05, ty - 0.05, zw - ((gx + gy) * 0.05) / LEVEL, want);
      if (rk > 0.01) {
        const dn = crag(tx + e, ty + e, zw + ((gx + gy) * e) / LEVEL, want);
        const lf = crag(tx - e, ty + e, zw + ((gy - gx) * e) / LEVEL, want), rt = crag(tx + e, ty - e, zw + ((gx - gy) * e) / LEVEL, want);
        sampleMat(M.HIGHROCK, tx, ty, wx, wyg);
        const seg = dn < 1 ? 0.25 + 0.75 * sstep((vnoise(tx * 6.2 + 9, ty * 6.2 + 3) - 0.38) / 0.14) : 1;
        const rim = 1 - 0.36 * (1 - dn) * seg - 0.18 * (1 - (lf < rt ? lf : rt));
        const d = 0.86 * (rim < 0.5 ? 0.5 : rim) * (1 - 0.14 * band);
        r += (V[0] * d - r) * rk; g += (V[1] * d - g) * rk; b += (V[2] * d - b) * rk;
        if (rk > MS_STEEP) MS_STEEP = rk;
      }
      const sh = up * (1 - rk);
      if (sh > 0) { r *= 1 - 0.24 * sh; g *= 1 - 0.22 * sh; b *= 1 - 0.18 * sh; }
    }
    if (sb && SB_DROP > 0) {
      // the band of crags under the snow edge is darker ground, and the snow's lip throws a short shadow down the slope
      const k = 1 - 0.1 * band;
      r *= k; g *= k; b *= k;
    }
    if (RS_W > 0) {
      // (v9) a right-hand riser is in the shade: a little cooler than its treads
      const c = (rocky === 1 ? RSP.game : RSP.smooth).cool * RS_RISE;
      r *= 1 - 0.07 * c; g *= 1 - 0.03 * c; b *= 1 + 0.03 * c;
    }
    RB[0] = r; RB[1] = g; RB[2] = b;
    if (RS_W > 0) {
      // (v9) the right-hand faces' steps: a crag on the slope takes the riser's shade but breaks the shadow at its foot
      // (and, by lbk, its lip: under Smooth v2; Game v2's riser rock keeps its lit top edge)
      const P = rocky === 1 ? RSP.game : RSP.smooth, br = 1 - 0.7 * rkS;
      MS_SHADE *= RS_K * (1 + P.lip * RS_LIP * (1 - P.lbk * rkS)) * (1 - P.foot * RS_FOOT * br);
    }
  }
  let FLAGV = 0; // what the grass-detail pass may draw on this pixel: 0 nothing, 1 pebbles, 2 grass tufts too, 3 forest tufts too
  const GRASSY = new Uint8Array(32); GRASSY[M.GRASS] = 2; GRASSY[M.ALPINE] = 2; GRASSY[M.ROCKMIX] = 2; GRASSY[M.FOREST] = 3; GRASSY[M.TAIGA] = 3;
  // whether the ground is at one level within FLATK of a point, with no warp moving its edges there: then every slope,
  // rim and curvature the relief light asks heightAt for comes out exactly zero, so they are not asked for (fix round 1:
  // load time; about half the points near a level change are on flat ground)
  const FLATK = 0.3;
  let FLAT_P = false;
  function flatAround(tx, ty) {
    if (GWARP && tx >= ICEW_BOX[0] - 0.9 && ty >= ICEW_BOX[1] - 0.9 && tx < ICEW_BOX[2] + 0.9 && ty < ICEW_BOX[3] + 0.9) return false;
