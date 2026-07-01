// Bridge between the page and the extension background. Injected only on Volt
// origins. Cannot fetch http itself (shares the page's mixed-content rules), so it
// only relays. Origin-locked: ignores any message not from this exact window/origin.

const TAG = '__voltLive'
const ORIGIN = location.origin
const VERSION = chrome.runtime.getManifest().version
const ports = new Map() // stream id -> Port

function b64ToBuf(b64) {
  const bin = atob(b64)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u.buffer
}

window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== ORIGIN) return
  const d = e.data
  if (!d || typeof d !== 'object' || !d[TAG]) return

  if (d[TAG] === 'ping') {
    // Report both presence and whether the optional host permission is granted,
    // so the app can distinguish "not installed" from "installed but not enabled".
    chrome.runtime.sendMessage({ type: 'permState' }, (r) => {
      window.postMessage({ [TAG]: 'pong', id: d.id, version: VERSION, granted: !!(r && r.granted) }, ORIGIN)
    })
    return
  }

  if (d[TAG] === 'nowPlaying') {
    chrome.runtime.sendMessage({ type: 'nowPlaying', channel: d.channel, panelUrl: d.panelUrl })
    return
  }

  if (d[TAG] === 'streamStart') {
    const port = chrome.runtime.connect({ name: 'ts-stream' })
    ports.set(d.id, port)
    port.onMessage.addListener((m) => {
      if (m.type === 'chunk') {
        const buf = b64ToBuf(m.b64)
        window.postMessage({ [TAG]: 'streamChunk', id: d.id, buf }, ORIGIN, [buf])
      } else {
        window.postMessage({ [TAG]: 'streamEvent', id: d.id, event: m }, ORIGIN)
      }
    })
    port.onDisconnect.addListener(() => ports.delete(d.id))
    port.postMessage({ type: 'start', url: d.url })
    return
  }

  if (d[TAG] === 'streamStop') {
    const port = ports.get(d.id)
    if (port) {
      try {
        port.disconnect()
      } catch {
        /* already gone */
      }
      ports.delete(d.id)
    }
    return
  }
})
