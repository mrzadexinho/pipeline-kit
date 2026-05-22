/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 * Produces a deterministic byte-form for wire-hash idempotency.
 *
 * Rules:
 * - Keys sorted lexicographically by UTF-16 code unit (per RFC 8785 §3.2.3).
 * - No whitespace.
 * - Integers stay integer; non-integer finite numbers use JS `String(n)` form.
 * - Rejects `NaN` / `Infinity` (throws TypeError pre-emission).
 * - Strings escape per RFC 8259 §7 with shortest escape sequences.
 * - Integer guard: throws TypeError if any integer is outside Number.MAX_SAFE_INTEGER ±.
 *   Callers wanting BigInt-style strings must pre-convert.
 */

/**
 * Encodes a single string value with RFC 8259 §7 minimal escaping.
 * Control characters < 0x20 are \uXXXX encoded.
 */
function encodeString(s: string): string {
  let result = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = s.charCodeAt(i);
    if (c === '"') {
      result += '\\"';
    } else if (c === '\\') {
      result += '\\\\';
    } else if (c === '\b') {
      result += '\\b';
    } else if (c === '\f') {
      result += '\\f';
    } else if (c === '\n') {
      result += '\\n';
    } else if (c === '\r') {
      result += '\\r';
    } else if (c === '\t') {
      result += '\\t';
    } else if (code < 0x20) {
      result += '\\u' + code.toString(16).padStart(4, '0');
    } else {
      result += c;
    }
  }
  result += '"';
  return result;
}

/**
 * Core recursive serialiser implementing RFC 8785 JCS.
 *
 * @throws {TypeError} on NaN, Infinity, unsafe integers, or undefined values.
 */
function serializeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    throw new TypeError('canonical-json: undefined is not a valid JSON value');
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (typeof value === 'number') {
    if (!isFinite(value)) {
      throw new TypeError(
        `canonical-json: non-finite number (${value}) cannot be serialized to JSON`,
      );
    }
    if (Number.isInteger(value)) {
      if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
        throw new TypeError(
          `canonical-json: integer ${value} is outside safe integer range; pre-convert to string`,
        );
      }
      return String(value);
    }
    return String(value);
  }

  if (typeof value === 'string') {
    return encodeString(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => serializeValue(item));
    return '[' + items.join(',') + ']';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    if (keys.length === 0) return '{}';
    const pairs = keys
      .filter((k) => obj[k] !== undefined)
      .map((k) => encodeString(k) + ':' + serializeValue(obj[k]));
    return '{' + pairs.join(',') + '}';
  }

  throw new TypeError(`canonical-json: unsupported value type: ${typeof value}`);
}

/**
 * Produce a deterministic RFC 8785 JSON string.
 *
 * @throws {TypeError} on NaN, Infinity, unsafe integers, or undefined.
 */
export function canonicalize(value: unknown): string {
  return serializeValue(value);
}

/**
 * Convenience: parse-then-canonicalize, for normalizing arbitrary JSON input.
 *
 * @throws {SyntaxError} if `raw` is not valid JSON.
 * @throws {TypeError} if the parsed value contains non-finite numbers or unsafe integers.
 */
export function canonicalizeRaw(raw: string): string {
  return canonicalize(JSON.parse(raw) as unknown);
}
