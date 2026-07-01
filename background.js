// The only part that touches the network. Streams the panel's continuous .ts over a
// long-lived Port (chunks as base64 — chrome.runtime can't transfer binary). The
// continuous flow keeps the MV3 worker alive. Keeps a per-tab status record for the
// popup. No credentials are stored.

const tabState = new Map() // tabId -> { channel, panelUrl, streaming, bytes, status, panelReach }

function u8ToB64(u8) {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < u8.length; i += CHUNK) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK))
  return btoa(bin)
}

function record(tabId, patch) {
  if (tabId == null) return
  const s = tabState.get(tabId) || { channel: null, panelUrl: null, streaming: false, bytes: 0, status: null, panelReach: null }
  Object.assign(s, patch)
  tabState.set(tabId, s)
}

// --- streaming (Port) ---
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ts-stream') return
  const tabId = port.sender && port.sender.tab ? port.sender.tab.id : null
  let reader = null
  let aborted = false

  port.onDisconnect.addListener(() => {
    aborted = true
    if (reader) reader.cancel().catch(() => {})
    record(tabId, { streaming: false })
  })

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'start') return
    record(tabId, { streaming: true, bytes: 0, status: null })
    try {
      const res = await fetch(msg.url, { cache: 'no-store', redirect: 'follow' })
      record(tabId, { status: res.status })
      port.postMessage({ type: 'status', status: res.status })
      if (!res.ok || !res.body) {
        port.postMessage({ type: 'end', reason: 'status ' + res.status })
        return
      }
      reader = res.body.getReader()
      let bytes = 0
      while (!aborted) {
        const { done, value } = await reader.read()
        if (done) {
          port.postMessage({ type: 'end', reason: 'eof' })
          break
        }
        bytes += value.byteLength
        if ((bytes & 0xfffff) < value.byteLength) record(tabId, { bytes }) // ~every 1 MB
        port.postMessage({ type: 'chunk', b64: u8ToB64(value) })
      }
    } catch (e) {
      console.error('[volt-live] stream fetch FAILED', msg.url, e)
      port.postMessage({ type: 'error', error: e && e.message ? e.message : String(e) })
    } finally {
      record(tabId, { streaming: false })
    }
  })
})

// --- one-shot messages (nowPlaying, popup status/test) ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : msg.tabId

  if (msg.type === 'nowPlaying') {
    record(tabId, { channel: msg.channel, panelUrl: msg.panelUrl })
    return
  }

  if (msg.type === 'status') {
    sendResponse(tabState.get(msg.tabId) || null)
    return
  }

  if (msg.type === 'testPanel') {
    const s = tabState.get(msg.tabId)
    const url = s && s.panelUrl
    if (!url) {
      sendResponse({ ok: false, error: 'no channel loaded yet' })
      return
    }
    fetch(url, { cache: 'no-store', redirect: 'follow' })
      .then((res) => {
        record(msg.tabId, { panelReach: res.status })
        sendResponse({ ok: true, status: res.status })
      })
      .catch((e) => {
        record(msg.tabId, { panelReach: 0 })
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) })
      })
    return true
  }
})

chrome.tabs.onRemoved.addListener((id) => tabState.delete(id))
