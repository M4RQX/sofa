// Sofá — partilha de ecrã P2P para até 4 pessoas.
// Sinalização: Trystero (rede Nostr, relés públicos). O vídeo vai direto entre PCs (WebRTC).
import * as trystero from 'https://esm.run/trystero@0.26.0'

const { joinRoom, selfId } = trystero

const APP_ID = 'sofa-partilha-ecra-m4rqx'
const MAX_PEOPLE = 4
const QUALITY = {
  nitido: { label: 'Nítido · texto e código (1080p · 30 fps)', width: 1920, height: 1080, fps: 30, hint: 'detail', bitrate: 4_000_000 },
  fluido: { label: 'Fluido · jogos e vídeos (1080p · 60 fps)', width: 1920, height: 1080, fps: 60, hint: 'motion', bitrate: 8_000_000 },
  leve: { label: 'Leve · net fraca (720p · 30 fps)', width: 1280, height: 720, fps: 30, hint: 'motion', bitrate: 1_500_000 },
}
const COLORS = ['#ff8a5b', '#5cc8ff', '#b78cff', '#6fe3a1', '#ffd166', '#ff6fae']

const $ = s => document.querySelector(s)
const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* sem storage */ } },
}

// ---------- estado ----------
let room = null
let hello = null
let myStream = null
const me = { name: '', sharing: false, color: colorFor(selfId) }
const peers = new Map() // peerId -> { name, color, sharing, stream, tile, rtt, greeted }
let focusId = null

// ---------- entrada ----------
const nameInput = $('#nameInput')
const roomInput = $('#roomInput')
nameInput.value = store.get('sofa-name') || ''
roomInput.value = cleanRoom(decodeURIComponent(location.hash.slice(1))) || randomRoom()
$('#newRoom').addEventListener('click', () => { roomInput.value = randomRoom() })
const joinBtn = $('#joinBtn')
joinBtn.disabled = false
joinBtn.textContent = 'Entrar na sala'

$('#joinForm').addEventListener('submit', e => {
  e.preventDefault()
  const name = nameInput.value.trim().slice(0, 20)
  const code = cleanRoom(roomInput.value)
  if (!name || code.length < 3) return
  store.set('sofa-name', name)
  me.name = name
  history.replaceState(null, '', `#${code}`)
  enterRoom(code)
})

function randomRoom() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, b => abc[b % abc.length]).join('')
}
function cleanRoom(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32)
}
function colorFor(id) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
}

// ---------- sala ----------
function enterRoom(code) {
  $('#lobby').hidden = true
  $('#app').hidden = false
  $('#roomCode').textContent = code

  room = joinRoom({ appId: APP_ID }, code, {
    onJoinError: ({ peerId, error }) => {
      const who = peers.get(peerId)?.name || 'um amigo'
      console.warn('onJoinError', peerId, error)
      toast(`Não deu para ligar a ${who}. A rede de um de vocês pode estar a bloquear ligações diretas.`, 'warn', 7000)
    },
  })

  hello = room.makeAction('hello')
  hello.onMessage = (data, { peerId }) => {
    const p = ensurePeer(peerId)
    const first = !p.greeted
    p.greeted = true
    p.name = String(data?.name ?? '').trim().slice(0, 20) || 'Anónimo'
    p.sharing = !!data?.sharing
    if (first) toast(`${p.name} sentou-se no sofá 🛋️`)
    if (!p.sharing) dropStream(peerId)
    refreshTile(peerId)
    render()
  }

  room.onPeerJoin = peerId => {
    ensurePeer(peerId)
    hello.send(myHello(), { target: peerId })
    if (myStream) {
      room.addStream(myStream, { target: peerId, metadata: { kind: 'screen' } })
      ;[1500, 4000].forEach(ms => setTimeout(tuneSenders, ms))
    }
    if (peers.size + 1 > MAX_PEOPLE) toast(`Já são ${peers.size + 1} no sofá — com mais de ${MAX_PEOPLE} a imagem pode ficar pior.`, 'warn')
    render()
  }

  room.onPeerLeave = peerId => {
    const p = peers.get(peerId)
    removeTile(peerId)
    peers.delete(peerId)
    if (p?.greeted) toast(`${p.name} saiu do sofá`)
    render()
  }

  room.onPeerStream = (stream, peerId) => {
    const p = ensurePeer(peerId)
    p.stream = stream
    p.sharing = true
    stream.addEventListener('removetrack', () => {
      if (!stream.getVideoTracks().some(t => t.readyState === 'live')) dropStream(peerId)
      else refreshTile(peerId)
    })
    stream.addEventListener('addtrack', () => refreshTile(peerId)) // o som pode chegar depois do vídeo
    showTile(peerId)
    render()
  }

  setInterval(updateStats, 1000)
  setInterval(updatePings, 3000)
  setInterval(updateNet, 1500)
  updateNet()
  render()
}

function ensurePeer(id) {
  let p = peers.get(id)
  if (!p) {
    p = { name: '…', color: colorFor(id), sharing: false, stream: null, tile: null, rtt: null, greeted: false }
    peers.set(id, p)
  }
  return p
}
const myHello = () => ({ name: me.name, sharing: me.sharing })

function leave() {
  stopShare()
  room?.leave()
  location.reload()
}
$('#leaveBtn').addEventListener('click', leave)
addEventListener('pagehide', () => room?.leave())

// ---------- partilhar o meu ecrã ----------
const qualitySel = $('#quality')
for (const [k, q] of Object.entries(QUALITY)) qualitySel.add(new Option(q.label, k))
qualitySel.value = QUALITY[store.get('sofa-quality')] ? store.get('sofa-quality') : 'nitido'
const audioChk = $('#withAudio')
audioChk.checked = store.get('sofa-audio') !== '0'

const canShare = !!navigator.mediaDevices?.getDisplayMedia
const shareBtn = $('#shareBtn')
if (!canShare) {
  shareBtn.disabled = true
  $('#shareLabel').textContent = 'Partilhar só dá no PC'
  qualitySel.disabled = true
  audioChk.disabled = true
}
shareBtn.addEventListener('click', () => (myStream ? stopShare() : startShare()))

qualitySel.addEventListener('change', async () => {
  store.set('sofa-quality', qualitySel.value)
  if (!myStream) return
  const q = QUALITY[qualitySel.value]
  const vt = myStream.getVideoTracks()[0]
  vt.contentHint = q.hint
  try { await vt.applyConstraints({ width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.fps, max: q.fps } }) } catch (e) { console.debug(e) }
  tuneSenders()
  toast(`Qualidade: ${q.label.split(' · ')[0]}`)
})
audioChk.addEventListener('change', () => {
  store.set('sofa-audio', audioChk.checked ? '1' : '0')
  if (myStream) toast('O som muda na próxima vez que partilhares.')
})

async function startShare() {
  const q = QUALITY[qualitySel.value]
  const withAudio = audioChk.checked
  let stream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.fps, max: q.fps } },
      audio: withAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
      systemAudio: withAudio ? 'include' : 'exclude',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    })
  } catch (e) {
    if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(`Não deu para partilhar: ${e.message}`, 'warn')
    return
  }
  const vt = stream.getVideoTracks()[0]
  vt.contentHint = q.hint
  vt.addEventListener('ended', stopShare) // botão "Parar partilha" do Chrome

  myStream = stream
  me.sharing = true
  room.addStream(stream, { metadata: { kind: 'screen' } })
  hello.send(myHello())
  ;[800, 2500, 6000].forEach(ms => setTimeout(tuneSenders, ms))

  showTile('self')
  setShareUI(true)
  render()
  if (withAudio && !stream.getAudioTracks().length) {
    toast('O som não veio. Janelas soltas não mandam som: partilha um separador ou o ecrã inteiro e deixa ligado “Partilhar áudio” na janela do Chrome/Edge.', 'warn', 9000)
  } else if (stream.getAudioTracks().length && vt.getSettings().displaySurface === 'monitor') {
    toast('Com o ecrã inteiro vai o som todo do PC, incluindo as vozes da call. Para mandar só o som de um vídeo, partilha esse separador.', 'warn', 8000)
  }
}

function stopShare() {
  if (!myStream) return
  const s = myStream
  myStream = null
  me.sharing = false
  try { room.removeStream(s) } catch (e) { console.debug(e) }
  s.getTracks().forEach(t => t.stop())
  hello.send(myHello())
  removeTile('self')
  setShareUI(false)
  render()
}

function setShareUI(on) {
  shareBtn.classList.toggle('on', on)
  $('#shareLabel').textContent = on ? 'Parar partilha' : 'Partilhar ecrã'
}

// O WebRTC limita o débito por defeito; aqui sobe-se o teto para o perfil escolhido.
async function tuneSenders() {
  if (!myStream) return
  const q = QUALITY[qualitySel.value]
  const vt = myStream.getVideoTracks()[0]
  for (const pc of Object.values(room.getPeers())) {
    for (const sender of pc.getSenders()) {
      if (sender.track !== vt) continue
      try {
        const params = sender.getParameters()
        if (!params.encodings?.length) params.encodings = [{}]
        params.encodings[0].maxBitrate = q.bitrate
        params.encodings[0].maxFramerate = q.fps
        await sender.setParameters(params)
      } catch (e) { console.debug('setParameters', e) }
    }
  }
}

// ---------- mosaicos de vídeo ----------
const stage = $('#stage')
const tpl = $('#tileTpl')

function tileInfo(id) {
  return id === 'self'
    ? { name: `${me.name} (tu)`, color: me.color, stream: myStream, self: true }
    : { ...peers.get(id), self: false }
}

function showTile(id) {
  const info = tileInfo(id)
  if (!info.stream) return
  const holder = id === 'self' ? me : peers.get(id)
  let t = holder.tile
  if (!t) {
    t = tpl.content.firstElementChild.cloneNode(true)
    t.dataset.id = id
    t.classList.toggle('self', info.self)
    wireTile(t, id)
    stage.append(t)
    holder.tile = t
  }
  const v = t.querySelector('video')
  if (v.srcObject !== info.stream) {
    v.srcObject = info.stream
    v.muted = info.self
    v.play().catch(() => {
      v.muted = true
      v.play().catch(() => {})
      t.querySelector('.tap').hidden = false
    })
  }
  refreshTile(id)
  layout()
}

function refreshTile(id) {
  const holder = id === 'self' ? me : peers.get(id)
  const t = holder?.tile
  if (!t) return
  const info = tileInfo(id)
  t.style.setProperty('--c', info.color)
  t.querySelector('.name').textContent = info.name
  const hasAudio = !info.self && !!info.stream?.getAudioTracks().length
  const vol = t.querySelector('.vol')
  vol.hidden = !hasAudio
  vol.textContent = t.querySelector('video').muted ? '🔇' : '🔊'
}

function wireTile(t, id) {
  const v = t.querySelector('video')
  const tap = t.querySelector('.tap')
  const unmute = () => { v.muted = false; v.play().catch(() => {}); tap.hidden = true; refreshTile(id) }
  tap.addEventListener('click', unmute)
  t.querySelector('.vol').addEventListener('click', () => {
    if (v.muted) unmute()
    else { v.muted = true; refreshTile(id) }
  })
  t.querySelector('.focus').addEventListener('click', () => {
    focusId = focusId === id ? null : id
    layout()
  })
  const fs = () => (document.fullscreenElement ? document.exitFullscreen() : t.requestFullscreen?.())
  t.querySelector('.fs').addEventListener('click', fs)
  v.addEventListener('dblclick', fs)
}

function dropStream(id) {
  const p = peers.get(id)
  if (!p) return
  p.stream = null
  removeTile(id)
}

function removeTile(id) {
  const holder = id === 'self' ? me : peers.get(id)
  if (!holder?.tile) return
  const v = holder.tile.querySelector('video')
  v.srcObject = null
  holder.tile.remove()
  holder.tile = null
  if (focusId === id) focusId = null
  layout()
}

function layout() {
  const tiles = [...stage.querySelectorAll('.tile')]
  stage.dataset.count = Math.min(tiles.length, 4)
  if (focusId && !tiles.some(t => t.dataset.id === focusId)) focusId = null
  const focused = !!focusId && tiles.length > 1
  stage.classList.toggle('focused', focused)
  for (const t of tiles) {
    t.classList.toggle('main', focused && t.dataset.id === focusId)
    t.querySelector('.focus').hidden = tiles.length < 2
  }
  $('#empty').hidden = tiles.length > 0
}

// ---------- barra de cima, estado, avisos ----------
function render() {
  const list = $('#people')
  list.replaceChildren(person(me.name, me.color, me.sharing, null, true), ...[...peers.values()].map(p => person(p.name, p.color, p.sharing, p.rtt, false)))

  const others = peers.size
  const anyone = [...peers.values()].some(p => p.stream) || !!myStream
  if (!anyone) {
    $('#emptyTitle').textContent = others ? 'Ninguém está a partilhar' : 'Estás sozinho no sofá'
    $('#emptyText').textContent = others
      ? `${others + 1} no sofá. Carrega em “Partilhar ecrã” para mostrares o teu.`
      : 'Copia o link e manda-o à malta. Quem abrir entra logo nesta sala.'
    $('#emptyCopy').hidden = others > 0
  }
  updateNet()
}

function person(name, color, sharing, rtt, isMe) {
  const li = document.createElement('li')
  li.className = 'person' + (sharing ? ' sharing' : '')
  li.style.setProperty('--c', color)
  const av = document.createElement('span')
  av.className = 'av'
  av.textContent = (name || '?').trim().charAt(0).toUpperCase()
  const nm = document.createElement('span')
  nm.textContent = (isMe ? 'Tu' : name) + (sharing ? ' 🖥️' : '')
  li.append(av, nm)
  if (rtt != null) {
    const r = document.createElement('span')
    r.className = 'rtt'
    r.textContent = `${Math.round(rtt)} ms`
    li.append(r)
  }
  li.title = sharing ? `${name} está a partilhar` : name
  return li
}

const frameCount = new WeakMap()
function updateStats() {
  for (const t of stage.querySelectorAll('.tile')) {
    const v = t.querySelector('video')
    const total = v.getVideoPlaybackQuality?.().totalVideoFrames ?? 0
    const last = frameCount.get(v) ?? total
    frameCount.set(v, total)
    const fps = Math.max(0, total - last)
    const sound = v.srcObject?.getAudioTracks().length ? '' : ' · 🔇 sem som'
    t.querySelector('.stats').textContent = v.videoWidth ? `${v.videoWidth}×${v.videoHeight} · ${fps} fps${sound}` : 'a ligar…'
  }
}

async function updatePings() {
  for (const id of peers.keys()) {
    room.ping(id).then(ms => {
      const p = peers.get(id)
      if (p) { p.rtt = ms; render() }
    }).catch(() => {})
  }
}

function updateNet() {
  const el = $('#netStatus')
  const sockets = Object.values(trystero.getRelaySockets?.() ?? {})
  const open = sockets.filter(s => s.readyState === 1).length
  const n = peers.size + 1
  if (!sockets.length || open > 0) {
    el.dataset.state = n > 1 ? 'ok' : 'wait'
    el.textContent = n > 1 ? `${n}/${MAX_PEOPLE} no sofá` : 'à espera da malta'
  } else {
    el.dataset.state = 'bad'
    el.textContent = 'sem ligação aos relés'
  }
}

async function copyLink() {
  const url = location.href
  try {
    await navigator.clipboard.writeText(url)
    toast('Link copiado — manda-o à malta 📋')
  } catch {
    toast(url, 'warn', 9000)
  }
}
$('#copyLink').addEventListener('click', copyLink)
$('#emptyCopy').addEventListener('click', copyLink)

function toast(text, kind = '', ms = 3500) {
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.textContent = text
  $('#toasts').append(el)
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350) }, ms)
}
