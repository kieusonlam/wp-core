/**
 * PHP serialization round-trip for WordPress meta values.
 *
 * WordPress stores arrays and objects in `wp_postmeta.meta_value` (TEXT column)
 * as PHP-serialized strings, e.g. `a:2:{s:3:"foo";s:3:"bar";...}`.  Scalars
 * (strings, numbers) are stored raw.
 *
 * This module wraps `php-serialize` with WordPress's discovery rule:
 *   `is_serialized($data)` — a string is PHP-serialized iff it matches the
 *   pattern `^[aOs]:\d+:` or is one of the magic short forms (`N;`, `b:0;`,
 *   `b:1;`, `i:N;`, `d:N;`).
 *
 * Use {@link maybeUnserialize} on every read from a meta-style table, and
 * {@link maybeSerialize} on every write.
 */

import * as phpSerialize from 'php-serialize';
import type { MetaValue } from '../types.js';

/**
 * Matches strings that look like PHP-serialized values. Lifted from WP core
 * `wp-includes/functions.php`.
 *
 * Cases:
 *   - `N;`              → null
 *   - `b:0;` / `b:1;`   → boolean
 *   - `s:NN:"..."` etc. → string
 *   - `i:NN;`           → integer
 *   - `d:NN;`           → float
 *   - `a:N:{...}`       → array (incl. assoc → object)
 *   - `O:N:"...":N:{}`  → PHP object (we treat as plain object)
 */
const SERIALIZED_PATTERN = /^(N;|b:[01];|s:\d+:|i:-?\d+;|d:[-\d.eE+]+;|a:\d+:|O:\d+:)/;

/**
 * Mirrors WordPress's `is_serialized()`. We're conservative: only strings can
 * be serialized. Returns true only when the value structurally matches the
 * expected pattern AND ends with `}` or `;`.
 */
export function isSerialized(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  if (!SERIALIZED_PATTERN.test(trimmed)) return false;
  const last = trimmed.charAt(trimmed.length - 1);
  return last === ';' || last === '}';
}

/**
 * Deserialize a meta value pulled from MySQL into its JS-native form.
 *
 * If the value is not a recognizably PHP-serialized string, it is returned
 * unchanged. This matches WP's `maybe_unserialize()` behavior.
 *
 * @example
 * maybeUnserialize('a:2:{s:3:"foo";s:3:"bar";s:1:"x";i:1;}')
 * // → { foo: 'bar', x: 1 }
 */
export function maybeUnserialize(value: unknown): MetaValue {
  if (!isSerialized(value)) return value as MetaValue;
  try {
    // php-serialize returns objects for assoc arrays. For numeric-indexed
    // arrays it returns objects with numeric keys — we coerce to JS array.
    const result = phpSerialize.unserialize(value as string);
    return normalize(result);
  } catch {
    // If parsing fails, fall back to raw string (matches WP's safe behaviour).
    return value as MetaValue;
  }
}

/**
 * Serialize a JS value for storage in a WP meta row.
 *
 * Strings, numbers, booleans, null, and Dates pass through as their raw
 * representation (matching WP's behaviour of *not* serializing scalars).
 * Arrays and objects are PHP-serialized.
 *
 * @example
 * maybeSerialize({ foo: 'bar' })  // → 'a:1:{s:3:"foo";s:3:"bar";}'
 * maybeSerialize('hello')         // → 'hello'
 * maybeSerialize(42)              // → '42'
 */
export function maybeSerialize(value: MetaValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '';
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
  // Arrays + plain objects → PHP-serialize
  return phpSerialize.serialize(value);
}

/**
 * Heuristic: convert php-serialize's "object with numeric keys" output into a
 * proper JS array when all keys are sequential integers starting at 0.
 * Recurses through nested structures.
 */
function normalize(value: unknown): MetaValue {
  if (value === null || value === undefined) return value as MetaValue;
  if (typeof value !== 'object') return value as MetaValue;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value.map((v) => normalize(v));
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const numericSequential =
    keys.length > 0 &&
    keys.every((k, i) => /^\d+$/.test(k) && Number(k) === i);
  if (numericSequential) {
    return keys.map((k) => normalize(obj[k]));
  }
  const out: Record<string, MetaValue> = {};
  for (const k of keys) out[k] = normalize(obj[k]);
  return out;
}
