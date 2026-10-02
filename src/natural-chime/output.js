export function createOutputAdapter(environment = globalThis) {
  let context = null;
  const activeOscillators = new Set();
  const AudioContextCtor = environment.AudioContext || environment.webkitAudioContext;

  async function unlock() {
    if (!AudioContextCtor) return { ok: false, reason: '当前浏览器不支持 Web Audio。' };
    try {
      if (!context) context = new AudioContextCtor();
      if (context.state !== 'running') await context.resume();
      if (context.state !== 'running') return { ok: false, reason: '浏览器音频仍未解锁；请再次点击开始报时。' };
      return { ok: true };
    } catch (error) { return { ok: false, reason: `音频解锁失败：${error?.message || '浏览器拒绝播放'}` }; }
  }

  async function requestNotificationPermission(chime) {
    if (!chime?.notifyEnabled) return { status: 'off' };
    if (!('Notification' in environment)) return { status: 'unavailable', message: '此浏览器不支持系统通知；声音仍可使用。' };
    if (environment.Notification.permission === 'granted') return { status: 'granted' };
    if (environment.Notification.permission === 'denied') return { status: 'denied', message: '系统通知权限已拒绝；声音仍可使用。' };
    try {
      const permission = await environment.Notification.requestPermission();
      return permission === 'granted' ? { status: 'granted' } : { status: permission, message: '系统通知未获授权；声音仍可使用。' };
    } catch { return { status: 'unavailable', message: '无法请求系统通知权限；声音仍可使用。' }; }
  }

  function beep(count) {
    if (!context || context.state !== 'running') return { ok: false, reason: '音频尚未解锁。' };
    let remaining = count; let finish;
    const done = new Promise(resolve => { finish = resolve; });
    try {
      const base = context.currentTime + 0.03;
      for (let index = 0; index < count; index += 1) {
        const oscillator = context.createOscillator(); const gain = context.createGain();
        const startAt = base + index * 0.3;
        oscillator.type = 'sine'; oscillator.frequency.value = index === count - 1 && count > 1 ? 880 : 660;
        gain.gain.setValueAtTime(0.0001, startAt); gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.18);
        oscillator.connect(gain).connect(context.destination); oscillator.onended = () => { activeOscillators.delete(oscillator); remaining -= 1; if (remaining === 0) finish(); }; activeOscillators.add(oscillator); oscillator.start(startAt); oscillator.stop(startAt + 0.2);
      }
      return { ok: true, done };
    } catch (error) { finish(); return { ok: false, reason: `提示音播放失败：${error?.message || '音频错误'}`, done }; }
  }

  function speak(text, chime) {
    if (!chime?.voiceEnabled) return { status: 'off' };
    const synth = environment.speechSynthesis; const Utterance = environment.SpeechSynthesisUtterance;
    if (!synth || !Utterance) return { status: 'unavailable', message: '语音不可用；提示音仍可播放。' };
    const voices = synth.getVoices?.() || [];
    const selected = voices.find(voice => voice.voiceURI === chime.selectedVoiceURI);
    const voice = selected || voices.find(item => item.lang?.toLowerCase() === 'zh-cn') || voices.find(item => item.lang?.toLowerCase().startsWith('zh-'));
    if (!voice) return { status: 'unavailable', message: '未找到中文语音；提示音仍可播放。' };
    try {
      synth.cancel(); const utterance = new Utterance(text); utterance.lang = voice.lang || 'zh-CN'; utterance.voice = voice; utterance.rate = 0.95; synth.speak(utterance); return { status: 'ok' };
    } catch { return { status: 'error', message: '语音播放失败；提示音仍可播放。' }; }
  }

  function notify(title, body, chime) {
    if (!chime?.notifyEnabled) return { status: 'off' };
    if (!('Notification' in environment)) return { status: 'unavailable', message: '此浏览器不支持系统通知；提示音仍可播放。' };
    if (environment.Notification.permission !== 'granted') return { status: 'unavailable', message: environment.Notification.permission === 'denied' ? '系统通知权限已拒绝；提示音仍可播放。' : '系统通知尚未获授权；提示音仍可播放。' };
    try { new environment.Notification(title, { body }); return { status: 'ok' }; }
    catch { return { status: 'error', message: '系统通知发送失败；提示音仍可播放。' }; }
  }

  async function announce(kind, boundaryMs, earlySeconds, chime, timeLabel, canOutput = async () => true) {
    const hhmm = timeLabel(boundaryMs).slice(0, 5);
    let sound = { ok: false, reason: '已取消声音输出。' };
    if (await canOutput()) sound = beep(kind === 'main' ? 3 : 1);
    const speech = kind === 'main' ? `现在时间，${hhmm}。` : `距离${hhmm}报时还有${earlySeconds}秒`;
    let speechResult = { status: 'off' };
    if (chime?.voiceEnabled) speechResult = await canOutput() ? speak(speech, chime) : { status: 'skipped', message: '已取消语音输出。' };
    let notification = { status: 'off' };
    if (chime?.notifyEnabled) notification = await canOutput()
      ? notify(kind === 'main' ? '报时' : '即将报时', kind === 'main' ? `现在时间 ${hhmm}` : `${hhmm}，还有 ${earlySeconds} 秒`, chime)
      : { status: 'skipped', message: '已取消系统通知。' };
    return { sound, speech: speechResult, notification };
  }

  async function preview(chime, canOutput = async () => true) {
    const sound = await canOutput() ? beep(2) : { ok: false, reason: '已取消试听输出。' };
    const speech = chime?.voiceEnabled ? await canOutput() ? speak('提示音试听。', chime) : { status: 'skipped', message: '已取消语音输出。' } : { status: 'off' };
    await (sound.done || Promise.resolve());
    const { done: _done, ...soundResult } = sound;
    return { sound: soundResult, speech };
  }

  function stop() {
    for (const oscillator of activeOscillators) { try { oscillator.stop(); } catch {} }
    activeOscillators.clear();
    try { environment.speechSynthesis?.cancel?.(); } catch {}
  }

  return { unlock, requestNotificationPermission, announce, preview, stop, get audioUnlocked() { return context?.state === 'running'; }, get context() { return context; } };
}
