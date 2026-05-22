import type { Result } from '../result.js';
import { err, ok } from '../result.js';
import type { WireDecodeError } from './types.js';

/**
 * RFC-3339 millisecond-precision timestamp regex.
 *
 * Groups:
 *   1: year, 2: month, 3: day,
 *   4: hour, 5: minute, 6: second,
 *   7: fractional seconds,
 *   8: timezone (Z or +/-HH:MM)
 */
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d+)(Z|[+-]\d{2}:\d{2})$/;

/** Days per month in a non-leap year. */
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function maxDaysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month] ?? 0;
}

/**
 * RFC-3339 millisecond-precision validator.
 *
 * Accepts: `YYYY-MM-DDTHH:mm:ss.sssZ` or `YYYY-MM-DDTHH:mm:ss.sss+-HH:mm`.
 *
 * Rejects (loud):
 * - Sub-millisecond fractional precision (>= 4 fractional digits) -> `wire/timestamp_sub_ms_precision`.
 * - Missing fractional / wrong shape / out-of-range fields -> `wire/timestamp_format_invalid`.
 *
 * Calendar validation (hour <= 23; month 1-12; day per month; minute/second <= 59).
 */
export function validateTimestamp(value: string): Result<string, WireDecodeError> {
  const match = TIMESTAMP_RE.exec(value);

  if (!match) {
    return err({
      code: 'wire/timestamp_format_invalid',
      message: `Timestamp "${value.slice(0, 64)}" does not match RFC-3339 millisecond-precision format`,
      near: value.slice(0, 64),
    });
  }

  const fractional = match[7]!;

  // Fractional digits must be exactly 3 (millisecond precision).
  // More digits = sub-millisecond precision.
  if (fractional.length > 3) {
    return err({
      code: 'wire/timestamp_sub_ms_precision',
      message: `Timestamp has sub-millisecond precision (${fractional.length} fractional digits); only 3 allowed`,
      near: value.slice(0, 64),
    });
  }

  if (fractional.length < 3) {
    return err({
      code: 'wire/timestamp_format_invalid',
      message: `Timestamp fractional seconds must be exactly 3 digits (got ${fractional.length})`,
      near: value.slice(0, 64),
    });
  }

  const year = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  const day = parseInt(match[3]!, 10);
  const hour = parseInt(match[4]!, 10);
  const minute = parseInt(match[5]!, 10);
  const second = parseInt(match[6]!, 10);

  if (month < 1 || month > 12) {
    return err({
      code: 'wire/timestamp_format_invalid',
      message: `Month ${month} is out of range (1-12)`,
      near: value.slice(0, 64),
    });
  }

  const maxDays = maxDaysInMonth(year, month);
  if (day < 1 || day > maxDays) {
    return err({
      code: 'wire/timestamp_format_invalid',
      message: `Day ${day} is out of range for month ${month} (1-${maxDays})`,
      near: value.slice(0, 64),
    });
  }

  if (hour > 23) {
    return err({
      code: 'wire/timestamp_format_invalid',
      message: `Hour ${hour} is out of range (0-23)`,
      near: value.slice(0, 64),
    });
  }

  if (minute > 59) {
    return err({
      code: 'wire/timestamp_format_invalid',
      message: `Minute ${minute} is out of range (0-59)`,
      near: value.slice(0, 64),
    });
  }

  if (second > 59) {
    return err({
      code: 'wire/timestamp_format_invalid',
      message: `Second ${second} is out of range (0-59)`,
      near: value.slice(0, 64),
    });
  }

  return ok(value);
}

/**
 * Encodes a `Date` to canonical wire form (always Z-suffixed millisecond-precision).
 *
 * Output format: `YYYY-MM-DDTHH:mm:ss.sssZ`
 */
export function encodeTimestamp(date: Date): string {
  return date.toISOString();
}
