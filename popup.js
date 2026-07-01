const $ = (id) => document.getElementById(id)

let msgTimer
function showMsg(text, kind) {
  const el = $('msg')
  el.textContent = text
  el.className = 'msg ' + (kind || '')
  clearTimeout(msgTimer)
  msgTimer = setTimeout(() => {
    el.textContent = ''
    el.className = 'msg'
  }, 4000)
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ? tab.id : null
}

function render(s) {
  $('ver').textContent = 'v' + chrome.runtime.getManifest().version
  if (!s) {
    $('state').textContent = '● idle'
    $('state').className = 'dot'
    return
  }
  $('state').textContent = s.streaming ? '● active' : '● idle'
  $('state').className = 'dot' + (s.streaming ? ' on' : '')
  const reach = s.panelReach == null ? '—' : s.panelReach === 200 ? '<span class="ok">OK</span>' : '<span class="bad">' + s.panelReach + '</span>'
  const status = s.status == null ? '—' : '<span class="' + (s.status === 200 ? 'ok' : 'bad') + '">' + s.status + '</span>'
  $('body').innerHTML =
    'Now playing: <b>' + (s.channel || '—') + '</b><br>' +
    'Stream: ' + status + ' · ' + (s.bytes ? Math.round(s.bytes / 1e6) + ' MB' : '0 MB') + '<br>' +
    'Panel reach: ' + reach
}

async function refresh() {
  const tabId = await activeTabId()
  if (tabId == null) return
  chrome.runtime.sendMessage({ type: 'status', tabId }, render)
}

$('test').addEventListener('click', async () => {
  const tabId = await activeTabId()
  if (tabId == null) return
  $('test').textContent = 'Testing…'
  chrome.runtime.sendMessage({ type: 'testPanel', tabId }, (r) => {
    $('test').textContent = 'Test panel'
    refresh()
    if (!r || !r.ok) showMsg('Panel unreachable: ' + ((r && r.error) || 'failed'), 'err')
    else showMsg('Panel reachable (' + r.status + ')', r.status === 200 ? 'ok' : 'err')
  })
})

$('copy').addEventListener('click', async () => {
  const tabId = await activeTabId()
  if (tabId == null) return
  chrome.runtime.sendMessage({ type: 'status', tabId }, (s) => {
    navigator.clipboard.writeText(JSON.stringify(s || {}, null, 2))
    $('copy').textContent = 'Copied'
    setTimeout(() => ($('copy').textContent = 'Copy log'), 1200)
  })
})

refresh()
