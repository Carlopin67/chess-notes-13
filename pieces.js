// ============================================================
// PIEZAS — glifos Unicode clásicos de ajedrez
// Usamos UN SOLO conjunto de glifos (el "relleno") para blancas
// y negras, y diferenciamos el color con un filtro CSS (invert).
// Así garantizamos que ambas piezas tengan EXACTAMENTE la misma
// forma y tamaño — el problema anterior era que iOS renderiza los
// glifos "huecos" (blancas) y "rellenos" (negras) de forma
// inconsistente e ignora el color de texto en algunas fuentes.
// ============================================================

const PIECE_GLYPHS = {
  K: '\u265A', Q: '\u265B', R: '\u265C', B: '\u265D', N: '\u265E', P: '\u265F'
};

function getPieceGlyph(type) {
  return PIECE_GLYPHS[type];
}
