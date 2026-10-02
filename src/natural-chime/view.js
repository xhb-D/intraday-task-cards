import { CHIME_PRESETS, periodMinutes, updateSlot, updateChimePreference } from './model.js';

const PRESET_LABELS = Object.freeze({ '3': '每 3 分钟', '5': '每 5 分钟', '15': '每 15 分钟', '30': '每 30 分钟', '60': '每 1 小时', '240': '每 4 小时', custom: '自定义' });

function node(tag, className, text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== '') element.textContent = text;
  return element;
}

function append(parent, ...children) { children.forEach(child => parent.appendChild(child)); return parent; }
function controlLabel(text, control, className = '') { const label = node('label', className, text); label.appendChild(control); return label; }

function slotInterval(slot) {
  const minutes = periodMinutes(slot);
  if (slot.preset === 'custom') return `自定义 ${minutes}分`;
  return minutes % 60 === 0 ? `每 ${minutes / 60} 小时` : `每 ${minutes} 分钟`;
}

function makeButton(text, action, className = '') {
  const button = node('button', className, text);
  button.type = 'button'; button.dataset.chimeAction = action;
  return button;
}

export function initChimeView({ summaryHost, settingsHost, onSlotChange, onPreferenceChange, onStart, onPause, onPreview }) {
  if (!summaryHost || !settingsHost) return { render() {}, refreshVoices() {}, showMessage() {} };

  const summary = node('section', 'chime-panel'); summary.setAttribute('aria-labelledby', 'chime-summary-title');
  const title = node('h2', '', '自然周期报时'); title.id = 'chime-summary-title';
  const clock = node('time', 'chime-clock', '北京时间 --:--:--'); clock.dataset.chimeClock = 'true';
  const runtime = node('p', 'chime-runtime', '已暂停'); runtime.setAttribute('role', 'status'); runtime.dataset.chimeRuntime = 'true';
  const prompt = node('p', 'chime-prompt', '浏览器后台或设备休眠期间错过的报时不会补播。');
  const count = node('p', 'chime-count', '已设置报时 0/5'); count.dataset.chimeCount = 'true';
  const tags = node('div', 'chime-tags'); tags.dataset.chimeTags = 'true'; tags.setAttribute('role', 'list');
  const empty = node('p', 'chime-empty', '尚未启用周期；可在设置中启用。'); empty.dataset.chimeEmpty = 'true';
  const actions = node('div', 'chime-actions');
  const startButton = makeButton('开始报时', 'start', 'chime-primary');
  const pauseButton = makeButton('暂停', 'pause');
  const previewButton = makeButton('试听提示音', 'preview');
  const settingsLink = node('a', 'chime-link', '报时设置 →'); settingsLink.href = '#/chime';
  append(actions, startButton, pauseButton, previewButton, settingsLink);
  const message = node('p', 'chime-message'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); message.dataset.chimeMessage = 'true';
  append(summary, title, clock, runtime, prompt, count, tags, empty, actions, message);
  summaryHost.replaceChildren(summary);

  const settings = node('section', 'chime-settings'); settings.setAttribute('aria-labelledby', 'chime-settings-title');
  const settingsTitle = node('h2', '', '自然周期报时设置'); settingsTitle.id = 'chime-settings-title';
  const explanation = node('p', 'chime-explanation', '周期按北京时间自然边界计算；页面恢复后从下一个未来边界继续，不补播错过的报时。');
  const slotGrid = node('div', 'chime-slot-grid');
  const slotControls = new Map();
  for (let index = 0; index < 5; index += 1) {
    const slotId = `slot-${index + 1}`;
    const fieldset = node('fieldset', 'chime-slot');
    const legend = node('legend', '', `周期 ${index + 1}`);
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.dataset.slotField = 'enabled';
    const enabledLabel = controlLabel('启用并显示在首页', enabled, 'chime-check');
    const preset = document.createElement('select'); preset.dataset.slotField = 'preset';
    CHIME_PRESETS.forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = PRESET_LABELS[value]; preset.appendChild(option); });
    const minutes = document.createElement('input'); minutes.type = 'number'; minutes.min = '1'; minutes.max = '1440'; minutes.step = '1'; minutes.inputMode = 'numeric'; minutes.dataset.slotField = 'minutes';
    const early = document.createElement('input'); early.type = 'number'; early.min = '0'; early.max = '600'; early.step = '1'; early.inputMode = 'numeric'; early.dataset.slotField = 'earlySeconds';
    const pause = makeButton('暂停', 'slot-pause', 'chime-slot-pause'); pause.dataset.slotId = slotId;
    const error = node('p', 'chime-slot-error'); error.dataset.slotError = slotId; error.setAttribute('role', 'status');
    const customMinutes = controlLabel('自定义分钟', minutes, 'chime-field chime-custom-minutes');
    fieldset.dataset.slotId = slotId;
    append(fieldset, legend, enabledLabel, controlLabel('报时周期', preset, 'chime-field'), customMinutes, controlLabel('提前提醒（秒）', early, 'chime-field'), pause, error);
    slotGrid.appendChild(fieldset);
    slotControls.set(slotId, { fieldset, enabled, preset, minutes, customMinutes, early, pause, error });
  }

  const preferences = node('fieldset', 'chime-preferences');
  const preferencesLegend = node('legend', '', '语音与通知');
  const voiceEnabled = document.createElement('input'); voiceEnabled.type = 'checkbox'; voiceEnabled.dataset.chimePreference = 'voiceEnabled';
  const voiceToggle = controlLabel('启用语音播报', voiceEnabled, 'chime-check');
  const voiceSelect = document.createElement('select'); voiceSelect.dataset.chimePreference = 'selectedVoiceURI'; voiceSelect.setAttribute('aria-label', '选择中文语音');
  const notifyEnabled = document.createElement('input'); notifyEnabled.type = 'checkbox'; notifyEnabled.dataset.chimePreference = 'notifyEnabled';
  const notifyToggle = controlLabel('启用浏览器系统通知（默认关闭）', notifyEnabled, 'chime-check');
  append(preferences, preferencesLegend, voiceToggle, controlLabel('播报声音', voiceSelect, 'chime-field'), notifyToggle);

  const settingsStatus = node('p', 'chime-settings-status'); settingsStatus.setAttribute('role', 'status'); settingsStatus.setAttribute('aria-live', 'polite'); settingsStatus.dataset.chimeSettingsStatus = 'true';
  const settingsActions = node('div', 'chime-actions');
  const settingsStart = makeButton('开始报时', 'start', 'chime-primary');
  const settingsPause = makeButton('暂停', 'pause');
  const settingsPreview = makeButton('试听提示音', 'preview');
  append(settingsActions, settingsStart, settingsPause, settingsPreview);
  append(settings, settingsTitle, explanation, slotGrid, preferences, settingsStatus, settingsActions);
  settingsHost.replaceChildren(settings);

  function settingError(slotId, error = '') {
    const controls = slotControls.get(slotId);
    controls.error.textContent = error;
    controls.error.hidden = !error;
  }

  function changeSlot(slotId, field, rawValue) {
    try {
      const patch = field === 'enabled' ? { enabled: rawValue } : field === 'preset' ? { preset: rawValue } : { [field]: rawValue };
      const next = updateSlot(currentChime, slotId, patch);
      if (onSlotChange?.(slotId, next) === false) { renderSettings(currentChime, currentLocked); renderTags(currentChime, currentLocked); throw new Error('设置尚未保存；已保留原值。'); }
      settingError(slotId);
    } catch (error) { settingError(slotId, error.message || '设置无效；已保留原值。'); }
  }

  function changePreference(key, value) {
    try {
      const next = updateChimePreference(currentChime, key, value);
      if (onPreferenceChange?.(key, next) === false) { renderSettings(currentChime, currentLocked); throw new Error('设置尚未保存；已保留原值。'); }
      preferenceError.textContent = '';
    } catch (error) { preferenceError.textContent = error.message || '设置无效；已保留原值。'; }
  }

  let currentChime = null;
  let preferenceError = node('p', 'chime-slot-error'); preferenceError.dataset.preferenceError = 'true'; preferenceError.setAttribute('role', 'status');
  preferences.appendChild(preferenceError);
  slotControls.forEach((controls, slotId) => {
    controls.enabled.addEventListener('change', () => changeSlot(slotId, 'enabled', controls.enabled.checked));
    controls.preset.addEventListener('change', () => changeSlot(slotId, 'preset', controls.preset.value));
    controls.minutes.addEventListener('change', () => changeSlot(slotId, 'minutes', Number(controls.minutes.value)));
    controls.early.addEventListener('change', () => changeSlot(slotId, 'earlySeconds', Number(controls.early.value)));
    controls.pause.addEventListener('click', () => changeSlot(slotId, 'paused', !currentChime?.slots?.find(slot => slot.slotId === slotId)?.paused));
  });
  voiceEnabled.addEventListener('change', () => changePreference('voiceEnabled', voiceEnabled.checked));
  voiceSelect.addEventListener('change', () => changePreference('selectedVoiceURI', voiceSelect.value));
  notifyEnabled.addEventListener('change', () => changePreference('notifyEnabled', notifyEnabled.checked));
  [startButton, settingsStart].forEach(button => button.addEventListener('click', () => onStart?.()));
  [pauseButton, settingsPause].forEach(button => button.addEventListener('click', () => onPause?.()));
  [previewButton, settingsPreview].forEach(button => button.addEventListener('click', () => onPreview?.()));

  function refreshVoices(chime = currentChime) {
    const voices = globalThis.speechSynthesis?.getVoices?.() || [];
    const prior = chime?.selectedVoiceURI ?? voiceSelect.value ?? '';
    voiceSelect.replaceChildren();
    const automatic = document.createElement('option'); automatic.value = ''; automatic.textContent = '自动选择中文语音'; voiceSelect.appendChild(automatic);
    if (prior && !voices.some(voice => voice.voiceURI === prior)) {
      const unavailable = document.createElement('option'); unavailable.value = prior; unavailable.textContent = '已保存的声音当前不可用'; voiceSelect.appendChild(unavailable);
    }
    voices.forEach(voice => {
      const option = document.createElement('option'); option.value = voice.voiceURI; option.textContent = `${voice.name}（${voice.lang || '未知语言'}）`; voiceSelect.appendChild(option);
    });
    voiceSelect.value = prior;
    if (voiceSelect.value !== prior) voiceSelect.value = '';
  }

  let lastChime = null; let currentLocked = false;
  function renderSettings(chime, locked) {
    currentChime = chime;
    currentLocked = locked;
    slotControls.forEach((controls, slotId) => {
      const slot = chime.slots.find(item => item.slotId === slotId);
      controls.enabled.checked = slot.enabled; controls.preset.value = slot.preset;
      controls.minutes.value = String(slot.minutes); controls.minutes.disabled = locked || slot.preset !== 'custom';
      controls.customMinutes.hidden = slot.preset !== 'custom';
      controls.early.value = String(slot.earlySeconds); controls.early.max = String(Math.min(600, periodMinutes(slot) * 60 - 1));
      controls.fieldset.disabled = locked;
      controls.pause.textContent = slot.paused ? '恢复' : '暂停';
      const actionName = slot.paused ? '恢复' : '暂停';
      const accessible = `${actionName}第 ${slotId.slice(-1)} 个周期（${slotInterval(slot)}）`;
      controls.pause.setAttribute('aria-label', accessible); controls.pause.title = accessible;
      controls.error.hidden = true;
    });
    voiceEnabled.checked = chime.voiceEnabled; notifyEnabled.checked = chime.notifyEnabled;
    voiceEnabled.disabled = locked; notifyEnabled.disabled = locked; voiceSelect.disabled = locked;
    if (voiceSelect.value !== chime.selectedVoiceURI || !voiceSelect.options.length) refreshVoices(chime);
    preferenceError.textContent = '';
    lastChime = chime;
  }

  function renderTags(chime, locked) {
    const enabled = chime.slots.filter(slot => slot.enabled);
    count.textContent = `已设置报时 ${enabled.length}/5`;
    tags.replaceChildren(); tags.hidden = enabled.length === 0; empty.hidden = enabled.length > 0;
    tags.style.setProperty('--tag-count', String(Math.max(1, enabled.length)));
    enabled.forEach(slot => {
      const tag = node('div', 'chime-tag'); tag.setAttribute('role', 'listitem');
      const label = node('span', 'chime-tag-label', slotInterval(slot));
      const control = makeButton(slot.paused ? '▶' : 'Ⅱ', 'slot-pause', 'chime-tag-toggle');
      const actionName = slot.paused ? '恢复' : '暂停'; const accessible = `${actionName}第 ${slot.slotId.slice(-1)} 个周期（${slotInterval(slot)}）`;
      control.setAttribute('aria-label', accessible); control.title = accessible; control.disabled = locked; control.dataset.slotId = slot.slotId;
      if (slot.paused) control.classList.add('is-paused');
      control.addEventListener('click', () => {
        changeSlot(slot.slotId, 'paused', !slot.paused);
      });
      tag.append(label, control); tags.appendChild(tag);
    });
  }

  function applyRuntime(status, messageText = '') {
    const runIntent = status?.runIntent || 'paused';
    let statusText;
    if (messageText) statusText = messageText;
    else if (status?.coordinationError) statusText = status.coordinationError;
    else if (runIntent !== 'running') statusText = '全局已暂停';
    else if (status?.eligibleSlots === 0) statusText = status?.enabledSlots === 0 ? '没有启用的周期' : '所有周期均已暂停';
    else if (status?.leader) statusText = '当前页面负责报时';
    else if (status?.leaderId && status.leaderId !== status.selfId) statusText = '由其他页面负责报时';
    else if (!status?.visible) statusText = '当前没有可用报时页面';
    else if (!status?.audioUnlocked) statusText = '报时已启动；本页面需点击后解锁音频';
    else statusText = '等待可见页面接管';
    runtime.textContent = statusText;
    settingsStatus.textContent = statusText;
    [startButton, settingsStart].forEach(button => { button.disabled = Boolean(status?.locked || !status?.visible); });
    [pauseButton, settingsPause].forEach(button => { button.disabled = Boolean(status?.locked || runIntent !== 'running'); });
    [previewButton, settingsPreview].forEach(button => { button.disabled = Boolean(status?.locked || !status?.visible); });
    message.textContent = status?.message || '';
    message.hidden = !message.textContent;
    settingsStatus.dataset.kind = status?.message || status?.coordinationError ? 'error' : 'normal';
  }

  return {
    render(chime, status = {}, { locked = false, clockText = '', messageText = '', force = false } = {}) {
      if (!chime) return;
      currentChime = chime;
      currentLocked = locked;
      if (chime !== lastChime || force) { renderSettings(chime, locked); renderTags(chime, locked); }
      else {
        slotControls.forEach((controls, slotId) => { controls.fieldset.disabled = locked; controls.pause.disabled = locked; });
        tags.querySelectorAll('button').forEach(button => { button.disabled = locked; });
      }
      clock.textContent = clockText ? `北京时间 ${clockText}` : '北京时间 --:--:--';
      applyRuntime({ ...status, locked }, messageText);
    },
    refreshVoices() { refreshVoices(currentChime); },
    showMessage(text) { message.textContent = text || ''; message.hidden = !message.textContent; settingsStatus.textContent = text || ''; },
    destroy() { summaryHost.replaceChildren(); settingsHost.replaceChildren(); }
  };
}
