/** Nearest real render, with a half-step maximum error and wrap at a full turn. */
export function spriteFacing(angle: number, count = 48): number {
  const turn = Math.PI * 2;
  const normalized = ((angle % turn) + turn) % turn;
  return Math.round((normalized / turn) * count) % count;
}

/** Half the old one-third-pixel placement step, shared by a body and its layers. */
export function snapTrainPixel(value: number): number {
  return Math.round(value * 6) / 6;
}
