// A random password for a new account (#1170), generated in the browser:
// the server never generates or returns one. The administrator reads it out
// or writes it down for the user, so the alphabet leaves out characters that
// are easy to confuse (0 and O, 1, l and I) and symbols that are hard to say.

const LETTERS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*?+=';
const ALPHANUMERIC = LETTERS + DIGITS;

// At least this long and with this many symbols, whatever the policy asks,
// which only raises both.
export const GENERATED_PASSWORD_MIN_LENGTH = 16;
export const GENERATED_PASSWORD_MIN_SYMBOLS = 2;

function defaultRandomValues(array) {
  return globalThis.crypto.getRandomValues(array);
}

// A uniform integer in [0, bound), from 32-bit random values, rejecting the
// values that would bias the remainder (none when bound divides 2^32).
export function randomBelow(bound, randomValues = defaultRandomValues) {
  const limit = Math.floor(0x100000000 / bound) * bound;
  const buffer = new Uint32Array(1);

  for (;;) {
    randomValues(buffer);
    if (buffer[0] < limit) {
      return buffer[0] % bound;
    }
  }
}

function pick(alphabet, randomValues) {
  return alphabet[randomBelow(alphabet.length, randomValues)];
}

/**
 * A password that meets `policy`, with at least one letter and one digit.
 *
 * @param {{minLength: number, minSymbols: number}|null} policy - auth-backend's
 *     limits, or null while unknown.
 * @param {(array: Uint32Array) => Uint32Array} [randomValues] - The random
 *     source, crypto.getRandomValues by default.
 * @returns {string}
 */
export function generatePassword(policy = null, randomValues = defaultRandomValues) {
  const length = Math.max(GENERATED_PASSWORD_MIN_LENGTH, Number(policy?.minLength) || 0);
  const symbols = Math.max(GENERATED_PASSWORD_MIN_SYMBOLS, Number(policy?.minSymbols) || 0);

  const characters = [pick(LETTERS, randomValues), pick(DIGITS, randomValues)];
  for (let index = 0; index < symbols; index += 1) {
    characters.push(pick(SYMBOLS, randomValues));
  }
  while (characters.length < length) {
    characters.push(pick(ALPHANUMERIC, randomValues));
  }

  // Fisher-Yates, so the symbols are not always at the start.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const other = randomBelow(index + 1, randomValues);
    [characters[index], characters[other]] = [characters[other], characters[index]];
  }

  return characters.join('');
}
