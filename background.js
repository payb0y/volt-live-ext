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
  const s = tabState.get(tabId) || { channel: null, panelUrl: null, streaming: false, bytes: 0, status: null, panelReach: null, stage: null, cdn: null, lastError: null, attempts: 0 }
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
    record(tabId, { streaming: true, bytes: 0, status: null, stage: 'connecting', cdn: null, lastError: null, attempts: 0 })

    // The panel load-balances each request to a rotating CDN session, and a node
    // is occasionally slow, drops immediately, or accepts the connection but never
    // responds (a hang). We wrap each attempt in an idle timeout (AbortController)
    // so a hang/stall is turned into an error, then re-fetch the panel URL (a FRESH
    // redirect to another session) and retry. Any healthy data resets the counter,
    // so a mid-stream drop on a live channel reconnects too. All the state
    // (stage / cdn / lastError / attempts) is recorded so the popup + Copy log show
    // exactly where a stuck stream is blocked.
    const MAX_FAILS = 6
    const BACKOFF_MS = 1200
    const CONNECT_TIMEOUT_MS = 12000 // no response headers within this → abort + retry
    const STALL_TIMEOUT_MS = 10000 // no data within this (after connecting) → abort + retry
    let total = 0
    let fails = 0
    while (!aborted && fails < MAX_FAILS) {
      const ctrl = new AbortController()
      let idle = null
      const arm = (ms, why) => {
        clearTimeout(idle)
        idle = setTimeout(() => ctrl.abort(new Error(why)), ms)
      }
      try {
        record(tabId, { stage: 'connecting', attempts: fails + 1 })
        arm(CONNECT_TIMEOUT_MS, 'connect timeout (no response in ' + CONNECT_TIMEOUT_MS / 1000 + 's)')
        const res = await fetch(msg.url, { cache: 'no-store', redirect: 'follow', signal: ctrl.signal })
        record(tabId, { status: res.status, cdn: res.url, stage: 'response ' + res.status })
        if (!res.ok || !res.body) throw new Error('http status ' + res.status)
        reader = res.body.getReader()
        arm(STALL_TIMEOUT_MS, 'stalled (no data in ' + STALL_TIMEOUT_MS / 1000 + 's)')
        while (!aborted) {
          const { done, value } = await reader.read()
          if (done) throw new Error('stream ended') // live shouldn't EOF — reconnect
          fails = 0
          arm(STALL_TIMEOUT_MS, 'stalled (no data in ' + STALL_TIMEOUT_MS / 1000 + 's)') // reset on each chunk
          total += value.byteLength
          if ((total & 0xfffff) < value.byteLength) record(tabId, { bytes: total, stage: 'streaming' }) // ~every 1 MB
          port.postMessage({ type: 'chunk', b64: u8ToB64(value) })
        }
      } catch (e) {
        if (aborted) break
        fails += 1
        const why = e && e.message ? e.message : String(e)
        record(tabId, { lastError: why, attempts: fails, stage: fails < MAX_FAILS ? 'retrying (' + fails + '/' + MAX_FAILS + ')' : 'failed' })
        console.error(`[volt-live] attempt ${fails}/${MAX_FAILS} failed:`, why)
        if (fails < MAX_FAILS) await new Promise((r) => setTimeout(r, BACKOFF_MS))
      } finally {
        clearTimeout(idle)
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
