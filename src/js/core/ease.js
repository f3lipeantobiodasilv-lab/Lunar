/**
 * Curvas de animação e utilidades numéricas compartilhadas pelo OS.
 * Mantidas sem dependências para poderem rodar no boot e no desktop.
 */

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
export const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Interpola suavemente entre `a` e `b` conforme `t` (0..1). */
export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Mapeia `value` de [inMin, inMax] para [outMin, outMax], limitado às bordas. */
export const mapRange = (value, inMin, inMax, outMin, outMax) =>
  outMin + ((clamp(value, inMin, inMax) - inMin) / (inMax - inMin)) * (outMax - outMin);

/** Retorna uma função que gera números pseudoaleatórios determinísticos (mulberry32). */
export function seededRandom(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
