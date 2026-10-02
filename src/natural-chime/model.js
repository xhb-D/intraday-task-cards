export const CHIME_SCHEMA_VERSION = 1;
export const CHIME_LEGACY_KEY = 'natural-chime-settings';
export const CHIME_PRESETS = Object.freeze(['3', '5', '15', '30', '60', '240', 'custom']);
const SLOT_IDS = Object.freeze(['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5']);
const LEGACY_IMPORT_STATUSES = Object.freeze(['defaults', 'legacy-v1', 'unified-v1-import-default', 'recovery-default']);
const chimeOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const chimeFail = (message, path = 'sections.chime') => { throw Object.assign(new Error(message), { code: 'CHIME_VALIDATION_ERROR', path }); };
const chimeExactKeys = (value, allowed, path) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) chimeFail('对象结构无效', path);
  const keys = Object.keys(value);
  if (keys.some(key => !allowed.includes(key)) || allowed.some(key => !chimeOwn(value, key))) chimeFail('包含未知或缺少必需字段', path);
};
const integer = (value, min, max, path) => {
  if (!Number.isInteger(value) || value < min || value > max) chimeFail('整数超出允许范围', path);
};

export function maxEarlySeconds(minutes) { return Math.min(600, minutes * 60 - 1); }
export function periodMinutes(slot) {
  if (slot.preset === 'custom') return slot.minutes;
  return Number(slot.preset);
}

export function defaultChime(legacyImport = { status: 'defaults', sourceVersion: null }) {
  return {
    schemaVersion: CHIME_SCHEMA_VERSION,
    slots: SLOT_IDS.map((slotId, index) => ({ slotId, enabled: index === 0, paused: false, preset: '5', minutes: 5, earlySeconds: 30 })),
    voiceEnabled: true,
    selectedVoiceURI: '',
    notifyEnabled: false,
    legacyImport: { ...legacyImport }
  };
}

export function validateChime(value, path = 'sections.chime') {
  chimeExactKeys(value, ['schemaVersion', 'slots', 'voiceEnabled', 'selectedVoiceURI', 'notifyEnabled', 'legacyImport'], path);
  if (value.schemaVersion !== CHIME_SCHEMA_VERSION) chimeFail('Natural Chime section 版本不受支持', `${path}.schemaVersion`);
  if (!Array.isArray(value.slots) || value.slots.length !== 5) chimeFail('必须恰有五个周期槽位', `${path}.slots`);
  value.slots.forEach((slot, index) => {
    const slotPath = `${path}.slots.${index}`;
    chimeExactKeys(slot, ['slotId', 'enabled', 'paused', 'preset', 'minutes', 'earlySeconds'], slotPath);
    if (slot.slotId !== SLOT_IDS[index]) chimeFail('周期槽位顺序或 ID 无效', `${slotPath}.slotId`);
    if (typeof slot.enabled !== 'boolean' || typeof slot.paused !== 'boolean') chimeFail('启用和暂停字段必须为布尔值', slotPath);
    if (!CHIME_PRESETS.includes(slot.preset)) chimeFail('周期预设无效', `${slotPath}.preset`);
    integer(slot.minutes, 1, 1440, `${slotPath}.minutes`);
    integer(slot.earlySeconds, 0, maxEarlySeconds(periodMinutes(slot)), `${slotPath}.earlySeconds`);
  });
  if (typeof value.voiceEnabled !== 'boolean' || typeof value.notifyEnabled !== 'boolean' || typeof value.selectedVoiceURI !== 'string') chimeFail('语音或通知偏好无效', path);
  chimeExactKeys(value.legacyImport, ['status', 'sourceVersion'], `${path}.legacyImport`);
  if (!LEGACY_IMPORT_STATUSES.includes(value.legacyImport.status) || ![null, 1].includes(value.legacyImport.sourceVersion)) chimeFail('legacyImport 标记无效', `${path}.legacyImport`);
  if (value.legacyImport.status === 'legacy-v1' && value.legacyImport.sourceVersion !== 1) chimeFail('legacy-v1 来源版本无效', `${path}.legacyImport.sourceVersion`);
  if (['defaults', 'unified-v1-import-default', 'recovery-default'].includes(value.legacyImport.status) && value.legacyImport.sourceVersion !== null) chimeFail('默认来源版本必须为空', `${path}.legacyImport.sourceVersion`);
  return true;
}

export function updateSlot(chime, slotId, patch) {
  validateChime(chime);
  const index = SLOT_IDS.indexOf(slotId);
  if (index < 0) chimeFail('周期槽位不存在', `slots.${slotId}`);
  const next = structuredCopy(chime);
  next.slots[index] = { ...next.slots[index], ...patch };
  validateChime(next);
  return next;
}

export function updateChimePreference(chime, key, value) {
  validateChime(chime);
  if (!['voiceEnabled', 'selectedVoiceURI', 'notifyEnabled'].includes(key)) chimeFail('偏好字段不可修改', key);
  const next = structuredCopy(chime); next[key] = value; validateChime(next); return next;
}

function structuredCopy(value) { return JSON.parse(JSON.stringify(value)); }
function legacyIntegerString(value, path, fallback) {
  if (value === undefined) return fallback;
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(parsed)) chimeFail('旧周期数值无效', path);
  return parsed;
}

export function migrateLegacyChime(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) chimeFail('旧报时设置不是对象');
  const version = value.version === undefined ? 1 : value.version;
  if (version !== 1) chimeFail('旧报时设置版本未知', 'legacy.version');
  const allowed = ['version', 'preset', 'minutes', 'early', 'voice', 'notify'];
  if (Object.keys(value).some(key => !allowed.includes(key))) chimeFail('旧版报时设置包含未知字段');

  const preset = chimeOwn(value, 'preset') ? value.preset : '5';
  if (!CHIME_PRESETS.includes(preset)) chimeFail('旧周期预设无效', 'legacy.preset');
  const minutes = legacyIntegerString(value.minutes, 'legacy.minutes', 5);
  const earlySeconds = legacyIntegerString(value.early, 'legacy.early', 30);
  integer(minutes, 1, 1440, 'legacy.minutes');
  integer(earlySeconds, 0, 60, 'legacy.early');

  const base = defaultChime({ status: 'legacy-v1', sourceVersion: 1 });
  base.slots[0] = { ...base.slots[0], enabled: true, preset, minutes, earlySeconds };
  base.voiceEnabled = value.voice === undefined ? true : value.voice;
  base.notifyEnabled = value.notify === undefined ? false : value.notify;
  if (typeof base.voiceEnabled !== 'boolean' || typeof base.notifyEnabled !== 'boolean') chimeFail('旧语音/通知偏好无效', 'legacy');
  validateChime(base);
  return base;
}
