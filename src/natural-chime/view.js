import { CHIME_PRESETS, periodMinutes, updateSlot, updateChimePreference } from './model.js';

const PRESET_LABELS = Object.freeze({ '3': '每 3 分钟', '5': '每 5 分钟', '15': '每 15 分钟', '30': '每 30 分钟', '60': '每 1 小时', '240': '每 4 小时', custom: '自定义' });
const NATIVE_STATUS_LABELS = Object.freeze({
  CONNECTED: '已连接', DISCONNECTED: '未连接', VERSION_MISMATCH: '版本不兼容', ERROR: '异常',
  RUNNING: '报时中', PAUSED: '已暂停', UNKNOWN: '状态未知',
  IN_SYNC: '配置已同步', MISMATCH: '配置未同步', CONFIG_MISMATCH: '配置未同步', NONE: '配置未同步'
});

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
  return `${minutes} 分钟`;
}

function makeButton(text, action, className = '') {
  const button = node('button', className, text);
  button.type = 'button'; button.dataset.chimeAction = action;
  return button;
}

export function initChimeView({ summaryHost, settingsHost, onSlotChange, onPreferenceChange, onStart, onPause, onPreview, mode = 'browser', getVoices, onModeChange }) {
  if (!summaryHost || !settingsHost) return { render() {}, refreshVoices() {}, showMessage() {} };

  const summary = node('section', 'chime-panel'); summary.setAttribute('aria-label', '自然周期报时');
  const modeSelect = document.createElement('select'); modeSelect.dataset.chimeExecutionMode = 'true'; modeSelect.setAttribute('aria-label', '本机报时方式');
  for (const [value, text] of [['browser', '浏览器报时'], ['native', '后台助手报时']]) { const option = node('option', '', text); option.value = value; modeSelect.appendChild(option); }
  modeSelect.value = mode;
  const modeHint = node('p', 'chime-message', mode === 'browser' ? '浏览器后台不保证持续报时。启用后台助手前请先完成安装和本机 HTTPS 设置。' : '后台助手断连不会切回浏览器。仅使用提示音和中文语音，不使用系统通知。');
  modeSelect.addEventListener('change', () => { const next = modeSelect.value; modeSelect.value = mode; onModeChange?.(next); });
  const setupButton = makeButton('安装和连接说明', 'setup');
  const setupHelp = node('p', 'chime-message', '本机个人版需先安装后台助手并完成 Personal HTTPS 信任设置，再选择后台助手报时；连接后点击开始报时。助手重启后保持暂停；断连请检查登录服务和证书状态。'); setupHelp.hidden = true;
  setupButton.addEventListener('click', () => { setupHelp.hidden = !setupHelp.hidden; });
  append(summary, controlLabel('本机报时方式', modeSelect), modeHint, setupButton, setupHelp);
  const clock = node('time', 'chime-clock', '北京时间 --:--:--'); clock.dataset.chimeClock = 'true';
  const runtimeStatus = node('p', 'chime-runtime', '全局已暂停'); runtimeStatus.dataset.chimeRuntime = 'true'; runtimeStatus.setAttribute('role', 'status'); runtimeStatus.setAttribute('aria-live', 'polite');
  const tags = node('div', 'chime-tags'); tags.dataset.chimeTags = 'true'; tags.setAttribute('role', 'list');
  const empty = node('p', 'chime-empty', '尚未启用周期；可在设置中启用。'); empty.dataset.chimeEmpty = 'true';
  const count = node('p', 'chime-count', '已设置报时 0/5'); count.dataset.chimeCount = 'true';
  const preferences = node('fieldset', 'chime-home-preferences');
  const preferencesLegend = node('legend', '', '播放选项');
  const voiceEnabled = document.createElement('input'); voiceEnabled.type = 'checkbox'; voiceEnabled.dataset.chimePreference = 'voiceEnabled';
  const voiceToggle = controlLabel('启用语音播报', voiceEnabled, 'chime-check');
  const voiceSelect = document.createElement('select'); voiceSelect.dataset.chimePreference = 'selectedVoiceURI'; voiceSelect.setAttribute('aria-label', '选择播报声音');
  const notifyEnabled = document.createElement('input'); notifyEnabled.type = 'checkbox'; notifyEnabled.dataset.chimePreference = 'notifyEnabled';
  const notifyToggle = controlLabel(mode === 'native' ? '系统通知（后台助手不使用）' : '浏览器系统通知', notifyEnabled, 'chime-check');
  const preferenceError = node('p', 'chime-slot-error'); preferenceError.dataset.preferenceError = 'true'; preferenceError.setAttribute('role', 'status'); preferenceError.setAttribute('aria-live', 'polite');
  append(preferences, preferencesLegend, voiceToggle, controlLabel('播放声音', voiceSelect, 'chime-field'), notifyToggle, preferenceError);
  const actions = node('div', 'chime-actions');
  const startButton = makeButton('开始报时', 'start', 'chime-primary');
  const pauseButton = makeButton('暂停', 'pause');
  const previewButton = makeButton('试听提示音', 'preview');
  const settingsLink = node('a', 'chime-link', '报时设置 →'); settingsLink.href = '#/chime';
  append(actions, startButton, pauseButton, previewButton, settingsLink);
  const message = node('p', 'chime-message'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); message.dataset.chimeMessage = 'true';
  append(summary, clock, runtimeStatus, tags, empty, count, preferences, actions, message);
  summaryHost.replaceChildren(summary);

  const settings = node('section', 'chime-settings'); settings.setAttribute('aria-labelledby', 'chime-settings-title');
  const settingsTitle = node('h2', '', '自然周期报时设置'); settingsTitle.id = 'chime-settings-title';
  const explanation = node('p', 'chime-explanation', mode === 'native' ? '周期按北京时间自然边界计算；后台助手执行报时。助手进程重启后保持暂停，需点击开始报时。' : '周期按北京时间自然边界计算；页面恢复后从下一个未来边界继续，不补播错过的报时。');
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

  append(settings, settingsTitle, explanation, slotGrid);
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
  startButton.addEventListener('click', () => onStart?.());
  pauseButton.addEventListener('click', () => onPause?.());
  previewButton.addEventListener('click', () => onPreview?.());

  function refreshVoices(chime = currentChime) {
    const voices = mode === 'native' ? (getVoices?.() || []) : (globalThis.speechSynthesis?.getVoices?.() || []);
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
    voiceEnabled.disabled = locked; notifyEnabled.disabled = locked || mode === 'native'; voiceSelect.disabled = locked;
    if (voiceSelect.value !== chime.selectedVoiceURI || !voiceSelect.options.length) refreshVoices(chime);
    preferenceError.textContent = '';
    lastChime = chime;
  }

  function renderTags(chime, locked) {
    const enabled = chime.slots.filter(slot => slot.enabled);
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
    if (mode === 'native') {
      const connectionText = NATIVE_STATUS_LABELS[status.connectionState || 'DISCONNECTED'] || '状态未知';
      const runtimeText = NATIVE_STATUS_LABELS[status.runtimeState || 'UNKNOWN'] || '状态未知';
      const configText = NATIVE_STATUS_LABELS[status.configState || 'UNKNOWN'] || '状态未知';
      runtimeStatus.textContent = `后台助手 · ${connectionText} · 协议 ${status.protocolVersion || '?'} · ${runtimeText} · ${configText}`;
      const messages = [];
      if (status.message) messages.push(status.message);
      if (status.connectionState !== 'CONNECTED') messages.push('当前后台运行状态未知；不会自动切换浏览器报时。');
      if (status.configState === 'MISMATCH') messages.push(status.runtimeState === 'RUNNING' ? '后台助手正在按另一份已应用配置运行；点击开始报时将同步当前网页配置并继续。' : '网页与助手配置不同；点击开始报时同步。');
      if (status.connectionState === 'CONNECTED' && status.helperStatus?.launchManaged === true) messages.push('后台助手由登录服务启动；重启后需手动开始报时。');
      if (status.connectionState === 'CONNECTED' && status.helperStatus?.lastRebaseReason === 'wake') messages.push('最近唤醒后已重新对齐未来报时；睡眠期间的提醒不补播。');
      messages.push('后台助手模式仅使用提示音和中文语音，不使用系统通知。');
      if (status.helperStatus?.tls?.state === 'TLS_RENEWAL_REQUIRED') messages.push('本机 HTTPS 证书将在30天内到期，请运行个人版续期命令。');
      if (status.helperStatus?.tls?.state === 'TLS_ROOT_REPLACEMENT_REQUIRED') messages.push('本机 HTTPS 根证书需明确更换；请按个人版恢复说明处理。');
      if (currentChime?.selectedVoiceURI && !(getVoices?.() || []).some(v => v.voiceURI === currentChime.selectedVoiceURI)) messages.push('已保存的声音在后台助手中不可用，当前使用中文默认声音。');
      message.textContent = messages.join(' '); message.hidden = !message.textContent;
      const unavailable = status.connectionState !== 'CONNECTED' || status.busy;
      startButton.disabled = Boolean(status.locked || unavailable || status.preferenceInvalid);
      pauseButton.disabled = Boolean(status.locked || unavailable || status.runtimeState !== 'RUNNING');
      previewButton.disabled = Boolean(status.locked || unavailable || status.preferenceInvalid);
      runtimeStatus.dataset.kind = messages.length ? 'error' : 'normal';
      return;
    }
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
    runtimeStatus.textContent = statusText;
    startButton.disabled = Boolean(status?.locked || !status?.visible);
    pauseButton.disabled = Boolean(status?.locked || runIntent !== 'running');
    previewButton.disabled = Boolean(status?.locked || !status?.visible);
    message.textContent = status?.message || '';
    message.hidden = !message.textContent;
    runtimeStatus.dataset.kind = messageText || status?.message || status?.coordinationError ? 'error' : 'normal';
  }

  return {
    render(chime, status = {}, { locked = false, clockText = '', messageText = '', force = false } = {}) {
      if (!chime) return;
      modeSelect.disabled = Boolean(locked || status.modeSwitch?.busy);
      if (status.preferenceInvalid) modeHint.textContent = '本机报时方式存档无法识别；已停止自动选择浏览器。连接助手并明确切换方式后重新保存。';
      else if (status.modeSwitch?.message) modeHint.textContent = status.modeSwitch.message;
      currentChime = chime;
      currentLocked = locked;
      if (chime !== lastChime || force) { renderSettings(chime, locked); renderTags(chime, locked); }
      else {
        slotControls.forEach((controls, slotId) => { controls.fieldset.disabled = locked; controls.pause.disabled = locked; });
        voiceEnabled.disabled = locked; voiceSelect.disabled = locked; notifyEnabled.disabled = locked || mode === 'native';
        tags.querySelectorAll('button').forEach(button => { button.disabled = locked; });
      }
      count.textContent = `已设置报时 ${chime.slots.filter(slot => slot.enabled).length}/5`;
      clock.textContent = clockText ? `北京时间 ${clockText}` : '北京时间 --:--:--';
      applyRuntime({ ...status, locked }, messageText);
    },
    refreshVoices() { refreshVoices(currentChime); },
    showMessage(text) { runtimeStatus.textContent = text || '全局已暂停'; runtimeStatus.dataset.kind = text ? 'error' : 'normal'; },
    destroy() { summaryHost.replaceChildren(); settingsHost.replaceChildren(); }
  };
}
