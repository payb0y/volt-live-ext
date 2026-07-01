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

// Broad host access is an OPTIONAL permission the user grants from the popup on
// first use — so the install shows no scary "all sites" warning. Nothing fetches
// until it's granted.
const HOST_PERMS = { origins: ['http://*/*', 'https://*/*'] }
function hasPerm() {
  return new Promise((resolve) => chrome.permissions.contains(HOST_PERMS, resolve))
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
    if (!(await hasPerm())) {
      port.postMessage({ type: 'error', error: 'not-enabled' })
      return
    }
    record(tabId, { streaming: true, bytes: 0, status: null })

    // The panel load-balances each request to a rotating CDN session, and a node
    // is occasionally slow or drops immediately (intermittent "Failed to fetch").
    // Re-fetch the panel URL (which issues a FRESH redirect to another session)
    // and retry a few consecutive times. Any healthy data resets the counter, so
    // a mid-stream drop on a live channel reconnects too. We never surface the
    // transient failure to the player unless the retries are exhausted.
    const MAX_FAILS = 5
    const BACKOFF_MS = 1200
    let total = 0
    let fails = 0
    while (!aborted && fails < MAX_FAILS) {
      try {
        const res = await fetch(msg.url, { cache: 'no-store', redirect: 'follow' })
        record(tabId, { status: res.status })
        if (!res.ok || !res.body) throw new Error('status ' + res.status)
        reader = res.body.getReader()
        while (!aborted) {
          const { done, value } = await reader.read()
          if (done) throw new Error('stream ended') // live shouldn't EOF — reconnect
          fails = 0
          total += value.byteLength
          if ((total & 0xfffff) < value.byteLength) record(tabId, { bytes: total }) // ~every 1 MB
          port.postMessage({ type: 'chunk', b64: u8ToB64(value) })
        }
      } catch (e) {
        if (aborted) break
        fails += 1
        console.error(`[volt-live] stream attempt failed (${fails}/${MAX_FAILS}):`, e && e.message ? e.message : e)
        if (fails < MAX_FAILS) await new Promise((r) => setTimeout(r, BACKOFF_MS))
      }
    }
    if (!aborted) port.postMessage({ type: 'error', error: 'Channel unavailable after several tries' })
    record(tabId, { streaming: false })
  })
})

// --- one-shot messages (nowPlaying, popup status/test) ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : msg.tabId

  if (msg.type === 'nowPlaying') {
    record(tabId, { channel: msg.channel, panelUrl: msg.panelUrl })
    return
  }

  if (msg.type === 'permState') {
    hasPerm().then((granted) => sendResponse({ granted }))
    return true
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
    hasPerm().then((granted) => {
      if (!granted) {
        sendResponse({ ok: false, error: 'not-enabled' })
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
    })
    return true
  }
})

chrome.tabs.onRemoved.addListener((id) => tabState.delete(id))
