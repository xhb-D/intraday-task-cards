/* Phase 2 one-period transport ONLY. No production storage or Web audio. */
(() => {
  function createClient({ base = 'http://127.0.0.1:17839', fetchImpl = globalThis.fetch, timeoutMs = 3000, loopbackHint = false } = {}) {
    let token;
    async function request(route, body) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutMs); // request timeout only
      try {
        const options = { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: abort.signal };
        if (loopbackHint) options.targetAddressSpace = 'loopback';
        if (body !== undefined) { options.method = 'POST'; options.headers = { 'Content-Type': 'application/json', 'X-Chime-Token': token || '' }; options.body = JSON.stringify(body); }
        const response = await fetchImpl(base + route, options);
        if (!response.ok) return { connection: 'HTTP_ERROR', message: `HTTP ${response.status}`, route };
        let data;
        try { data = await response.json(); } catch (error) { return { connection: 'HTTP_ERROR', message: `Invalid JSON: ${error.message}`, route }; }
        if (data.protocolVersion !== 1) return { connection: 'INCOMPATIBLE_PROTOCOL', data, route };
        if (data.ok !== true || !['RUNNING', 'PAUSED'].includes(data.runtimeState)) return { connection: 'HTTP_ERROR', message: 'Invalid helper response', route };
        if (route === '/health') token = data.sessionToken;
        return { connection: 'CONNECTED', data, route };
      } catch (error) { return { connection: 'DISCONNECTED', message: `${error.name}: ${error.message}`, route }; }
      finally { clearTimeout(timer); }
    }
    return {
      health: () => request('/health'), status: () => request('/status'),
      async mutate(route, body = {}) {
        if (!['/config', '/start', '/pause'].includes(route)) throw new Error('Unknown mutation');
        if (!token) { const health = await request('/health'); if (health.connection !== 'CONNECTED') return health; if (!token) return { connection: 'HTTP_ERROR', message: 'Handshake token missing' }; }
        return request(route, body);
      }
    };
  }
  function mount(container) {
    container.innerHTML = `<h1>macOS Chime Helper · Phase 2 POC</h1><p>独立单周期测试参数，不是正式五槽位模型。声音及 timer 均在 Swift。</p>
<label>地址 <select id="chime-host"><option>127.0.0.1</option><option>localhost</option></select></label>
<label><input id="chime-hint" type="checkbox"> targetAddressSpace: loopback（实验比较）</label>
<label>测试周期（秒）<input id="chime-period" type="number" min="15" max="86400" value="15"></label>
<p><button id="chime-refresh">Refresh / Connect</button> <button id="chime-config">Apply config</button> <button id="chime-start">START</button> <button id="chime-pause">PAUSE</button></p>
<p>自动状态轮询 <input id="chime-poll" type="checkbox">（关闭后 Helper 仍应继续）</p>
<p>START 只启动当前已应用的周期；更改输入后先 Apply config。</p>
<pre id="chime-status" role="status" aria-live="polite">DISCONNECTED · 尚未检测</pre><pre id="chime-log"></pre>`;
    const el = id => container.querySelector('#chime-' + id);
    let client, busy = false, polling;
    function reset() { client = createClient({ base: 'http://' + el('host').value + ':17839', loopbackHint: el('hint').checked }); el('status').textContent = 'DISCONNECTED · 地址已改变，需重新检测'; }
    reset(); el('host').onchange = reset; el('hint').onchange = reset;
    async function act(action) {
      if (busy) return;
      busy = true;
      for (const button of container.querySelectorAll('button')) button.disabled = true;
      el('host').disabled = true; el('hint').disabled = true;
      try {
        const result = await action();
        // Display runtimeState only from a successful helper response, never optimistic RUNNING.
        el('status').textContent = JSON.stringify(result, null, 2);
        el('log').textContent = (new Date().toISOString() + ' ' + JSON.stringify(result) + '\n' + el('log').textContent).slice(0, 18000);
      } finally { busy = false; for (const button of container.querySelectorAll('button')) button.disabled = false; el('host').disabled = false; el('hint').disabled = false; }
    }
    el('refresh').onclick = () => act(() => client.health());
    el('config').onclick = () => {
      const periodSeconds = Number(el('period').value);
      if (!Number.isInteger(periodSeconds) || periodSeconds < 15 || periodSeconds > 86400) { el('status').textContent = 'INPUT_ERROR · 周期必须为 15–86400 整数'; return; }
      act(() => client.mutate('/config', { periodSeconds }));
    };
    el('start').onclick = () => act(() => client.mutate('/start'));
    el('pause').onclick = () => act(() => client.mutate('/pause'));
    el('poll').onchange = () => { clearInterval(polling); if (el('poll').checked) polling = setInterval(() => act(() => client.status()), 3000); }; // UI telemetry ONLY
    return () => clearInterval(polling);
  }
  globalThis.ChimePOC = { createClient, mount };
  if (typeof document !== 'undefined') {
    let container = document.getElementById('macos-chime-poc');
    if (!container) {
      // DevTools-only overlay on the existing HTTPS origin. No deploy; no storage writes.
      container = document.createElement('section'); container.id = 'macos-chime-poc';
      container.style.cssText = 'position:fixed;inset:20px;z-index:2147483647;overflow:auto;background:white;color:black;padding:24px;font:16px system-ui;border:3px solid #247;';
      document.body.append(container);
    }
    if (!container.dataset.mounted) { mount(container); container.dataset.mounted = 'true'; }
  }
})();
