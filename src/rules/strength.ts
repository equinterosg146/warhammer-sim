/** Unit strength terms from the core rules appendix (Starting Strength and Half-strength). */
export type Strength = 'full' | 'belowStarting' | 'half' | 'belowHalf' | 'destroyed';

/**
 * For a unit that started with more than one model, strength counts models; for a single model it
 * counts that model's wounds.
 */
export function strengthFrom(startingModels: number, modelsLeft: number, singleWounds?: { left: number; max: number }): Strength {
  if (modelsLeft === 0) return 'destroyed';
  if (startingModels === 1 && singleWounds) {
    const { left, max } = singleWounds;
    if (left >= max) return 'full';
    if (left * 2 < max) return 'belowHalf';
    if (left * 2 === max) return 'half';
    return 'belowStarting';
  }
  if (modelsLeft >= startingModels) return 'full';
  if (modelsLeft * 2 < startingModels) return 'belowHalf';
  if (modelsLeft * 2 === startingModels) return 'half';
  return 'belowStarting';
}
