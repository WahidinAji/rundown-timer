// Stage screen. Read-only: it renders whatever the controller last saved.
import * as core from './core.js'
import { loadState, onExternalChange } from './store.js'

const params = new URLSearchParams(location.search)
const preview = params.has('preview')
const screen = params.get('screen') ?? '1'
const $ = (id) => document.getElementById(id)
const stage = $('stage')

let state = loadState()
let lastSentAt = 0
// A reload must not replay an old flash.
let lastFlashAt = state?.flashAt ?? 0

// Restarts a CSS animation by removing and re-adding its class.
function replay(element, className) {
  element.classList.remove(className)
  void element.offsetWidth
  element.classList.add(className)
}

onExternalChange((next) => {
  state = next
  render()
})

// Writes only what changed, since this runs several times a second.
const shown = new Map()
function set(element, key, value) {
  const id = `${element.id}:${key}`
  if (shown.get(id) === value) return
  shown.set(id, value)
  if (key === 'text') element.textContent = value
  else if (key === 'hidden') element.hidden = value
  else if (key === 'width') element.style.width = value
  else element.dataset[key] = value
}

function render() {
  const now = Date.now()
  set($('clock'), 'text', core.clockOf(now))
  if (!state) {
    set($('title'), 'text', 'Waiting for the controller')
    return
  }

  const item = core.currentItem(state)
  const next = core.neighbour(state, 1)
  const live = state.live
  const phase = core.phaseOf(item, live, state.settings, now)
  const started = core.hasStarted(live)

  set(stage, 'layout', state.settings.screens[screen] ?? 'full')
  set(stage, 'phase', phase)
  set(stage, 'running', String(live.running))
  set(stage, 'started', String(started))
  set($('blackout'), 'hidden', !state.blackout)

  set($('kind'), 'text', core.LABELLED_KINDS.includes(item?.kind) ? core.KINDS[item.kind] : '')
  set($('title'), 'text', item?.title ?? '')
  set($('speaker'), 'text', item?.speaker ?? '')

  let timer = '--:--'
  let status = ''
  let progress = 0
  if (item?.duration === 0) {
    timer = core.formatSeconds(Math.floor(core.elapsedOf(live, now) / 1000))
  } else if (item) {
    const left = core.remainingOf(item, live, now)
    const total = core.totalOf(item, live)
    timer = core.formatTimer(left)
    progress = total ? Math.min(1, core.elapsedOf(live, now) / total) : 1
    if (core.BREAK_KINDS.includes(item.kind)) {
      const back = started ? now + Math.max(0, left) : null
      status = back ? `Back at ${core.clockOf(back)}` : `Until ${core.endOf(item)}`
    }
    if (phase === 'over') status = 'Time is up'
  }
  if (item && !live.running) status = started ? 'Paused' : status || 'Ready'
  set($('timer'), 'text', timer)
  set($('timer'), 'length', String(timer.length))
  set($('status'), 'text', status)
  set($('progress'), 'width', `${(progress * 100).toFixed(2)}%`)

  set($('next'), 'text', next ? `Next ${next.start} · ${[next.title, next.speaker].filter(Boolean).join(' · ')}` : '')

  const message = state.message
  set($('message'), 'hidden', !message.visible)
  set($('message-text'), 'text', message.text)
  set(stage, 'message', String(message.visible))
  if (message.visible && message.sentAt !== lastSentAt) {
    // Restart the flash animation for every new message.
    replay($('message'), 'flash')
  }
  lastSentAt = message.sentAt

  if (state.flashAt !== lastFlashAt && now - state.flashAt < 3000) replay($('flash'), 'on')
  lastFlashAt = state.flashAt
}

render()
setInterval(render, 200)

if (!preview) {
  document.body.classList.add('screen')
  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen().catch(() => {})
  }
  addEventListener('dblclick', fullscreen)
  addEventListener('keydown', (event) => {
    if (event.key === 'f' || event.key === 'F') fullscreen()
  })

  const hint = $('hint')
  hint.hidden = false
  setTimeout(() => (hint.hidden = true), 6000)

  // Hide the mouse pointer when it stops moving.
  let idle
  addEventListener('mousemove', () => {
    document.body.classList.remove('idle')
    clearTimeout(idle)
    idle = setTimeout(() => document.body.classList.add('idle'), 2000)
  })

  // Keep the stage screen from sleeping.
  const keepAwake = () => navigator.wakeLock?.request('screen').catch(() => {})
  keepAwake()
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && keepAwake())
}
