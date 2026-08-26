/**
 * @file A starting guess, from what the device will admit about itself.
 *
 * THE PROBLEM THIS SOLVES.
 *
 * The controller in `tiers.js` is measurement-driven, which is the right way
 * round: it watches real frames and reacts to what actually happened. But it
 * cannot react to a frame that has not been drawn yet, so a fresh page always
 * starts at `full` and spends the first second or so discovering the device.
 *
 * On a laptop that is invisible. On a two-core phone it means the first second
 * of the page — the second in which someone decides whether to stay — is the
 * worst second the site will ever have. The controller then dutifully degrades,
 * and the visitor has already formed their opinion.
 *
 * So: read the cheap signals before the first frame, start in the tier they
 * suggest, and let measurement take over immediately after.
 *
 * WHY THESE SIGNALS ARE NOT TRUSTED VERY FAR.
 *
 * Every one of them is weak, and pretending otherwise would be worse than not
 * using them:
 *
 * - `hardwareConcurrency` counts cores, not speed. Eight slow cores are not
 *   faster than four quick ones, and browsers routinely lie about it for
 *   fingerprinting reasons — Safari has reported a fixed number for years.
 * - `deviceMemory` is Chromium-only, is bucketed to powers of two, and caps at
 *   8 no matter how much RAM the machine has. It correlates loosely with GPU
 *   performance and not at all reliably.
 * - `connection.effectiveType` describes the *network*, which is not the
 *   device. A fast phone on a train is not a slow phone.
 *
 * Which is why this module only ever picks a *starting* tier, never a ceiling.
 * Nothing here can stop the controller climbing back to `full` a second later
 * if the device turns out to be fine — and on a mis-detected device, that is
 * exactly what happens. The cost of guessing wrong is one second of slightly
 * plainer animation. The cost of not guessing is one second of stutter.
 *
 * `saveData` is the exception and is treated as an instruction rather than a
 * hint: someone who has turned on Data Saver has asked for less of everything,
 * and second-guessing that is rude.
 */

/** @typedef {import('./tiers.js').Tier} Tier */

/**
 * @typedef {object} DeviceSignals
 * @property {number|null} cores   `hardwareConcurrency`, or null if unavailable.
 * @property {number|null} memory  `deviceMemory` in GB, or null.
 * @property {boolean} saveData    The user asked for reduced data.
 * @property {string|null} effectiveType  '4g', '3g', '2g', 'slow-2g', or null.
 * @property {Tier} tier           The tier these signals suggest starting in.
 * @property {string} reason       Why, in one line, for logs and the HUD.
 */

/**
 * Read what the browser will tell us. Never throws.
 *
 * @param {any} [nav] Injectable for tests. Defaults to `navigator`.
 * @returns {DeviceSignals}
 */
export function readDevice(nav) {
  const n = nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);

  /** @type {number|null} */
  let cores = null;
  /** @type {number|null} */
  let memory = null;
  let saveData = false;
  /** @type {string|null} */
  let effectiveType = null;

  try {
    const c = n?.hardwareConcurrency;
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) cores = c;

    const m = n?.deviceMemory;
    if (typeof m === 'number' && Number.isFinite(m) && m > 0) memory = m;

    const conn = n?.connection;
    if (conn) {
      saveData = conn.saveData === true;
      if (typeof conn.effectiveType === 'string') effectiveType = conn.effectiveType;
    }
  } catch {
    // Some embedded webviews throw on property access rather than returning
    // undefined. A device we cannot read is a device we do not guess about.
  }

  const { tier, reason } = classify({ cores, memory, saveData, effectiveType });
  return { cores, memory, saveData, effectiveType, tier, reason };
}

/**
 * Turn the signals into a starting tier.
 *
 * The thresholds are deliberately conservative — they only fire on devices
 * that are unambiguously small. A four-core machine with 4 GB is a mid-range
 * phone that will probably cope, so it starts at `full` and gets measured like
 * everything else. Guessing on the margin is how you end up degrading laptops.
 *
 * @param {{cores: number|null, memory: number|null, saveData: boolean, effectiveType: string|null}} s
 * @returns {{tier: Tier, reason: string}}
 */
export function classify(s) {
  // An instruction, not a hint. Data Saver means less of everything.
  if (s.saveData) return { tier: 'minimal', reason: 'saveData is on' };

  // Two signals agreeing is worth more than either alone, because each one on
  // its own is noisy enough to be misleading.
  const fewCores = s.cores !== null && s.cores <= 2;
  const littleMemory = s.memory !== null && s.memory <= 2;

  if (fewCores && littleMemory) {
    return { tier: 'minimal', reason: `${s.cores} cores, ${s.memory}GB` };
  }
  if (fewCores || littleMemory) {
    const which = fewCores ? `${s.cores} cores` : `${s.memory}GB`;
    return { tier: 'reduced', reason: which };
  }

  // Deliberately NOT used to pick a tier on its own: a slow connection says
  // nothing about how fast the device can draw. It is reported so a caller who
  // knows their own workload can decide otherwise.
  return { tier: 'full', reason: 'no reason to hold back' };
}
