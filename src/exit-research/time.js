import { validationError } from './csv.js';
const pad = (value, length = 2) => String(value).padStart(length, '0');

// Naive local times use calendar strings, never a fabricated epoch or timezone.
export function parseTradovateTime(raw, sourceRowNumber, field) {
  if (typeof raw !== 'string') throw validationError('INVALID_TIME', sourceRowNumber, field);
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  const local = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!iso && !local) throw validationError('INVALID_TIME', sourceRowNumber, field);
  const parts = iso ? iso.slice(1, 7) : [local[3], local[1], local[2], local[4], local[5], local[6]];
  const [year, month, day, hour, minute, second] = parts.map(Number);
  const millis = iso ? Number((iso[7] || '').padEnd(3, '0')) : 0;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) throw validationError('INVALID_TIME', sourceRowNumber, field);
  const normalized = `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.${pad(millis, 3)}`;
  if (local) return { raw, normalized, sortKey: normalized, timezone: 'unknown', offsetMinutes: null };
  const offset = iso[8];
  const offsetHour = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const offsetMinute = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  if (offsetHour > 23 || offsetMinute > 59) throw validationError('INVALID_TIME', sourceRowNumber, field);
  const offsetMinutes = (offset === 'Z' || offset[0] === '+' ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  const sortKey = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMinutes * 60000).toISOString();
  return { raw, normalized: normalized + offset, sortKey, timezone: offset === 'Z' ? 'UTC' : 'explicit-offset', offsetMinutes };
}
