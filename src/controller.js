// Timekeeper's window. Every change to the state goes through commit(), which
// saves to localStorage. The stage windows render from there.
import * as core from './core.js'
import { loadState, saveState, onExternalChange } from './store.js'
import { htmlToText, readRundown } from './import.js'
import idsw from './idsw-2026.js'

const $ = (id) => document.getElementById(id)

function h(tag, props = {}, ...children) {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key === 'class') element.className = value
    else if (key === 'value') element.value = value
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value)
    else element.setAttribute(key, value === true ? '' : value)
  }
  element.append(...children.flat().filter((child) => child != null && child !== false && child !== ''))
  return element
}

const seed = () => core.createState(core.fromSchedule(idsw))

let state = loadState() ?? seed()
saveState(state)
let dayIndex = Math.max(0, state.days.indexOf(core.findItem(state, state.live.itemId)?.day))
let editing = false

function commit(change, { list = true } = {}) {
  const draft = structuredClone(state)
  change(draft, Date.now())
  state = draft
  saveState(state)
  render({ list })
}

// Another controller tab changed the state.
onExternalChange((next) => {
  state = next
  render()
})

// ---------------------------------------------------------------------------
// Rendering

function render({ list = true } = {}) {
  dayIndex = Math.min(dayIndex, state.days.length - 1)
  renderDays()
  if (list) renderItems()
  renderLive()
  renderPreview()
  renderMessage()
  tick()
}

function renderDays() {
  const liveDay = core.findItem(state, state.live.itemId)?.day
  const tabs = [
    ...state.days.map((day, index) =>
      h('button', {
        type: 'button',
        class: `day${index === dayIndex ? ' selected' : ''}${day === liveDay ? ' has-live' : ''}`,
        'aria-pressed': String(index === dayIndex),
        onclick: () => {
          dayIndex = index
          render()
        },
      }, day.name, day.label && h('small', {}, day.label)),
    ),
  ]
  if (editing) tabs.push(h('button', { type: 'button', class: 'day add-day', onclick: addDay }, '+ Day'))
  $('days').replaceChildren(...tabs)
  const day = state.days[dayIndex]
  $('day-edit').hidden = !editing
  $('day-name').value = day.name
  $('day-label').value = day.label
  $('day-delete').disabled = state.days.length < 2
  $('add-item').hidden = !editing
  $('edit').textContent = editing ? 'Done' : 'Edit'
  $('edit').setAttribute('aria-pressed', String(editing))
}

function renderItems() {
  const items = state.days[dayIndex].items
  const rows = []
  items.forEach((item, index) => {
    rows.push(editing ? editRow(item) : itemRow(item))
    const next = items[index + 1]
    if (!next) return
    const gap = core.minutesOf(next.start) - core.minutesOf(item.start) - item.duration
    if (gap > 0) rows.push(h('li', { class: 'gap' }, `${gap} min changeover`))
    if (gap < 0) rows.push(h('li', { class: 'gap overlap' }, `Overlaps the next segment by ${-gap} min`))
  })
  if (!items.length) rows.push(h('li', { class: 'empty' }, editing ? 'No segments yet.' : 'No segments yet. Use Edit or Import to add some.'))
  $('items').replaceChildren(...rows)
}


function itemRow(item) {
  const isLive = item.id === state.live.itemId
  const log = state.log[item.id]
  return h('li', { class: `item kind-${item.kind}${isLive ? ' live' : ''}${log && !isLive ? ' done' : ''}`, 'data-id': item.id },
    h('button', { type: 'button', class: 'item-main', onclick: () => pick(item) },
      h('span', { class: 'item-time' }, item.start, h('small', {}, core.endOf(item))),
      h('span', { class: 'item-duration' }, item.duration ? `${item.duration}m` : '—'),
      h('span', { class: 'item-what' },
        h('span', { class: 'item-title' }, core.LABELLED_KINDS.includes(item.kind) && h('em', { class: 'badge' }, core.KINDS[item.kind]), item.title || 'Untitled'),
        (item.speaker || item.pending || item.note) && h('span', { class: 'item-speaker' },
          item.speaker,
          item.pending && h('em', { class: 'pending' }, `${item.pending} TBA`),
          item.note && h('span', { class: 'note' }, item.note),
        ),
      ),
      h('span', { class: 'item-actual' }, isLive ? h('span', { class: 'live-timer', id: 'live-timer' }) : actual(item, log)),
    ),
  )
}

// Actual start, minutes late and run length, for example "09:47 +2 · 47m".
function actual(item, log) {
  if (!log) return null
  const midnight = new Date(log.start).setHours(0, 0, 0, 0)
  const late = Math.round((log.start - midnight) / 60000) - core.minutesOf(item.start)
  const ran = log.end ? Math.round((log.end - log.start) / 60000) : null
  return [
    core.clockOf(log.start),
    late !== 0 && Math.abs(late) < 180 && h('span', { class: late > 0 ? 'late' : 'early' }, late > 0 ? ` +${late}` : ` ${late}`),
    ran != null && h('span', { class: ran > item.duration && item.duration ? 'late' : '' }, ` · ${ran}m`),
  ]
}

function editRow(item) {
  const update = (fields) => commit((s) => {
    const at = core.findItem(s, item.id)
    if (fields.speaker && at.item.pending === 'speaker') at.item.pending = null
    if (fields.title && ['title', 'subject'].includes(at.item.pending)) at.item.pending = null
    Object.assign(at.item, fields)
    if ('start' in fields) core.sortItems(at.day)
  }, { list: 'start' in fields })

  return h('li', { class: `item editing kind-${item.kind}` },
    h('input', { type: 'time', class: 'f-start', value: item.start, 'aria-label': 'Start', required: true,
      onchange: (event) => event.target.value && update({ start: event.target.value }) }),
    h('label', { class: 'f-duration' },
      h('input', { type: 'number', min: 0, value: item.duration, 'aria-label': 'Duration in minutes',
        onchange: (event) => update({ duration: Math.max(0, Math.round(Number(event.target.value) || 0)) }) }),
      'min'),
    h('select', { class: 'f-kind', 'aria-label': 'Kind', onchange: (event) => update({ kind: event.target.value }) },
      Object.entries(core.KINDS).map(([kind, label]) => h('option', { value: kind, selected: kind === item.kind }, label))),
    h('input', { class: 'f-title', value: item.title, placeholder: 'Title', 'aria-label': 'Title',
      onchange: (event) => update({ title: event.target.value.trim() }) }),
    h('input', { class: 'f-speaker', value: item.speaker, placeholder: item.pending === 'speaker' ? 'Speaker TBA' : 'Speaker', 'aria-label': 'Speaker',
      onchange: (event) => update({ speaker: event.target.value.trim() }) }),
    h('input', { class: 'f-note', value: item.note, placeholder: 'Private note (not on stage)', 'aria-label': 'Note',
      onchange: (event) => update({ note: event.target.value.trim() }) }),
    h('span', { class: 'row-actions' },
      h('button', { type: 'button', onclick: () => split(item), title: 'Split into equal parts, e.g. lightning talks' }, 'Split'),
      h('button', { type: 'button', class: 'danger', onclick: () => removeItem(item) }, 'Delete'),
    ),
  )
}

function renderPreview() {
  for (const n of [1, 2]) {
    $(`preview-caption-${n}`).textContent = `Screen ${n} · ${core.LAYOUTS[state.settings.screens[n]] ?? core.LAYOUTS.full}`
  }
}

function renderLive() {
  const item = core.currentItem(state)
  const live = state.live
  $('now-kind').textContent = item ? `${core.KINDS[item.kind]} · ${core.findItem(state, item.id).day.name}` : 'Nothing loaded'
  $('now-title').textContent = item ? [item.title, item.speaker].filter(Boolean).join(' — ') : 'Click a segment in the rundown'
  $('toggle').textContent = live.running ? 'Pause' : core.hasStarted(live) ? 'Resume' : 'Start'
  $('toggle').classList.toggle('running', live.running)
  $('toggle').disabled = !item
  $('prev').disabled = !core.neighbour(state, -1)
  $('next').disabled = !core.neighbour(state, 1)
  $('reset').disabled = !item || (!core.hasStarted(live) && !live.adjust)
}

function renderMessage() {
  const { message, blackout, settings } = state
  $('message-live').hidden = !message.visible
  $('message-live-text').textContent = message.visible ? `On stage: ${message.text}` : ''

  const queue = state.queue
  $('queue-section').hidden = !queue.length
  $('queue-count').textContent = `Queue · ${queue.length} message${queue.length === 1 ? '' : 's'}`
  $('queue').replaceChildren(
    ...queue.map((entry, index) =>
      h('li', {},
        h('span', { class: 'queue-text' }, entry.text),
        h('button', { type: 'button', class: 'queue-show', onclick: () => commit((s, now) => core.showQueued(s, entry.id, now), { list: false }) }, 'Show'),
        h('button', { type: 'button', 'aria-label': 'Move up', disabled: index === 0, onclick: () => commit((s) => core.moveQueued(s, entry.id, -1), { list: false }) }, '↑'),
        h('button', { type: 'button', 'aria-label': 'Move down', disabled: index === queue.length - 1, onclick: () => commit((s) => core.moveQueued(s, entry.id, 1), { list: false }) }, '↓'),
        h('button', { type: 'button', 'aria-label': 'Remove', class: 'danger', onclick: () => commit((s) => core.unqueue(s, entry.id), { list: false }) }, '✕'),
      ),
    ),
  )

  $('blackout').setAttribute('aria-pressed', String(blackout))
  $('blackout').textContent = blackout ? 'End blackout' : 'Blackout stage'
  $('presets').replaceChildren(
    ...settings.presets.map((text) =>
      h('button', {
        type: 'button',
        class: message.visible && message.text === text ? 'selected' : '',
        onclick: () => commit((s, now) => core.showMessage(s, text, now), { list: false }),
      }, text),
    ),
  )
}

// Time-dependent text, refreshed several times a second.
function tick() {
  const now = Date.now()
  $('clock').textContent = new Date(now).toLocaleTimeString('en-GB')
  const item = core.currentItem(state)
  const live = state.live

  const delta = core.scheduleDelta(state, now)
  const deltaText = delta == null ? '' : core.formatDelta(delta)
  $('delta').textContent = deltaText
  $('delta').className = `delta ${delta == null ? '' : deltaText === 'On time' ? 'on-time' : delta > 0 ? 'behind' : 'ahead'}`

  if (!item) {
    $('now-times').textContent = ''
    return
  }
  const log = state.log[item.id]
  const left = core.remainingOf(item, live, now)
  $('now-times').textContent = [
    `Planned ${item.start}–${core.endOf(item)}`,
    log && `started ${core.clockOf(log.start)}`,
    core.hasStarted(live) && item.duration && `ends ~${core.clockOf(now + Math.max(0, left))}`,
    live.adjust && `adjusted ${live.adjust > 0 ? '+' : '−'}${core.formatAmount(live.adjust)}`,
  ].filter(Boolean).join(' · ')

  const liveTimer = $('live-timer')
  if (liveTimer) {
    liveTimer.textContent = item.duration ? core.formatTimer(left) : core.formatSeconds(Math.floor(core.elapsedOf(live, now) / 1000))
    liveTimer.dataset.phase = core.phaseOf(item, live, state.settings, now)
  }
}

// ---------------------------------------------------------------------------
// Actions

function pick(item) {
  if (item.id === state.live.itemId) return
  const current = core.currentItem(state)
  if (state.live.running && !confirm(`"${current.title}" is still running. Stop it and load "${item.title}"?`)) return
  commit((s, now) => core.load(s, item.id, now))
}

function addDay() {
  commit((s) => {
    s.days.push({ id: core.newId(), name: `Day ${s.days.length + 1}`, date: '', label: '', items: [] })
  })
  dayIndex = state.days.length - 1
  render()
}

function addItem() {
  commit((s) => {
    const items = s.days[dayIndex].items
    const last = items.at(-1)
    const start = last ? core.minutesOf(last.start) + last.duration + 5 : 9 * 60
    items.push({ id: core.newId(), start: core.hhmm(start), duration: 30, title: '', speaker: '', kind: 'talk', pending: null, note: '' })
  })
  $('items').querySelector('li.item:last-of-type .f-title')?.focus()
}

function removeItem(item) {
  commit((s, now) => {
    if (s.live.itemId === item.id) {
      const target = core.neighbour(s, 1) ?? core.neighbour(s, -1)
      if (target) core.load(s, target.id, now)
      else core.unload(s, now)
    }
    const at = core.findItem(s, item.id)
    at.day.items.splice(at.index, 1)
    delete s.log[item.id]
  })
}

function split({ id }) {
  const item = core.findItem(state, id).item
  const answer = prompt(`Split "${item.title}" (${item.duration} min) into how many parts?`, '6')
  const parts = Number.parseInt(answer, 10)
  if (parts >= 2) commit((s) => core.splitItem(s, item.id, parts))
}

async function openScreen(n) {
  const screen = window.open(`viewer.html?screen=${n}`, `stage-${n}`, 'popup,width=960,height=540')
  // Chrome and Edge can place the window on an external display directly.
  try {
    const details = await window.getScreenDetails?.()
    const target = details?.screens.filter((s) => !s.isPrimary)[n - 1]
    if (screen && target) {
      screen.moveTo(target.availLeft, target.availTop)
      screen.resizeTo(target.availWidth, target.availHeight)
    }
  } catch {
    // Without permission or browser support, the timekeeper drags the window instead.
  }
}

function exportRundown() {
  const blob = new Blob([JSON.stringify(core.toSchedule(state), null, 2)], { type: 'application/json' })
  const link = h('a', { href: URL.createObjectURL(blob), download: `rundown-${new Date().toISOString().slice(0, 10)}.json` })
  link.click()
  URL.revokeObjectURL(link.href)
}

// ---------------------------------------------------------------------------
// Wiring

$('toggle').addEventListener('click', () => commit((s, now) => core.toggle(s, now)))
$('prev').addEventListener('click', () => commit((s, now) => core.step(s, -1, now)))
$('next').addEventListener('click', (event) => commit((s, now) => core.step(s, 1, now, { autostart: event.shiftKey })))
$('reset').addEventListener('click', () => commit((s) => core.reset(s)))
// In each split button, the main part adds or removes 1 minute and the chevron opens a menu of amounts.
const AMOUNTS = [1, 10, 30, 60, 300, 600, 1200, 1800] // seconds
const amountLabel = (seconds) => (seconds < 60 ? `${seconds}s` : `${seconds / 60}m`)

function closeMenus() {
  for (const split of document.querySelectorAll('.split')) {
    split.querySelector('.split-menu').hidden = true
    split.querySelector('.split-toggle').setAttribute('aria-expanded', 'false')
  }
}

// The control panel scrolls, so the menu uses fixed positioning to avoid being clipped.
function openMenu(split, { focus }) {
  closeMenus()
  const toggle = split.querySelector('.split-toggle')
  const menu = split.querySelector('.split-menu')
  menu.hidden = false
  toggle.setAttribute('aria-expanded', 'true')
  const anchor = split.getBoundingClientRect()
  const below = anchor.bottom + 6 + menu.offsetHeight <= innerHeight
  menu.style.top = below ? `${anchor.bottom + 6}px` : `${Math.max(8, anchor.top - 6 - menu.offsetHeight)}px`
  if (split.dataset.sign === '-1') menu.style.left = `${anchor.left}px`
  else menu.style.left = `${anchor.right - menu.offsetWidth}px`
  if (focus) menu.querySelector('button').focus()
}

for (const split of document.querySelectorAll('.split')) {
  const sign = Number(split.dataset.sign)
  const toggle = split.querySelector('.split-toggle')
  const menu = split.querySelector('.split-menu')
  menu.replaceChildren(
    ...AMOUNTS.map((seconds) =>
      h('button', {
        type: 'button',
        role: 'menuitem',
        onclick: () => {
          closeMenus()
          commit((s) => core.adjust(s, sign * seconds * 1000))
        },
      }, `${sign < 0 ? '−' : '+'} ${amountLabel(seconds)}`),
    ),
  )
  // A click from the keyboard has detail 0. In that case focus moves into the menu.
  toggle.addEventListener('click', (event) => (menu.hidden ? openMenu(split, { focus: event.detail === 0 }) : closeMenus()))
  // The global shortcuts ignore keys pressed inside a menu, so Space and Enter pick an item.
  menu.addEventListener('keydown', (event) => {
    const items = [...menu.querySelectorAll('button')]
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (step) {
      event.preventDefault()
      items[(items.indexOf(document.activeElement) + step + items.length) % items.length].focus()
    } else if (event.key === 'Escape') {
      closeMenus()
      toggle.focus()
    }
  })
}
addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.split')) closeMenus()
})
addEventListener('resize', closeMenus)
document.querySelector('.control').addEventListener('scroll', closeMenus)

for (const button of document.querySelectorAll('[data-adjust]')) {
  button.addEventListener('click', () => commit((s) => core.adjust(s, Number(button.dataset.adjust))))
}
$('open-1').addEventListener('click', () => openScreen(1))
$('open-2').addEventListener('click', () => openScreen(2))

function sendMessage({ queue }) {
  const text = $('message-input').value.trim()
  if (!text) return
  commit((s, now) => (queue ? core.queueMessage(s, text) : core.showMessage(s, text, now)), { list: false })
  $('message-input').value = ''
}
$('message-form').addEventListener('submit', (event) => {
  event.preventDefault()
  sendMessage({ queue: false })
})
$('message-input').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || !event.shiftKey) return
  event.preventDefault()
  sendMessage({ queue: true })
})
$('message-queue').addEventListener('click', () => sendMessage({ queue: true }))
$('queue-next').addEventListener('click', () => commit((s, now) => core.showQueued(s, null, now), { list: false }))
$('message-hide').addEventListener('click', () => commit((s) => core.hideMessage(s), { list: false }))
$('flash').addEventListener('click', () => commit((s, now) => core.flash(s, now), { list: false }))
$('blackout').addEventListener('click', () => commit((s) => (s.blackout = !s.blackout), { list: false }))

$('edit').addEventListener('click', () => {
  editing = !editing
  render()
})
$('add-item').addEventListener('click', addItem)
$('day-name').addEventListener('change', (event) => commit((s) => (s.days[dayIndex].name = event.target.value.trim() || `Day ${dayIndex + 1}`)))
$('day-label').addEventListener('change', (event) => commit((s) => (s.days[dayIndex].label = event.target.value.trim())))
$('day-delete').addEventListener('click', () => {
  const day = state.days[dayIndex]
  if (!confirm(`Delete ${day.name} and its ${day.items.length} segments?`)) return
  commit((s, now) => {
    if (core.findItem(s, s.live.itemId)?.day.id === day.id) core.unload(s, now)
    s.days.splice(dayIndex, 1)
  })
})
$('export').addEventListener('click', exportRundown)

// Import dialog
let imported = null
let importName = ''
function previewImport() {
  const summary = $('import-summary')
  try {
    imported = readRundown($('import-text').value, importName)
    const count = imported.days.reduce((sum, day) => sum + day.items.length, 0)
    summary.textContent = `Found ${imported.days.map((day) => `${day.name} (${day.items.length} segments)`).join(', ')}. ` +
      `Replacing clears the actual times logged so far.`
    summary.className = 'summary ok'
    $('import-apply').disabled = count === 0
  } catch (error) {
    imported = null
    summary.textContent = $('import-text').value.trim() ? error.message : ''
    summary.className = 'summary error'
    $('import-apply').disabled = true
  }
}
$('import-open').addEventListener('click', () => {
  $('import-text').value = ''
  importName = ''
  $('import-file').value = ''
  previewImport()
  $('import-dialog').showModal()
})
$('import-text').addEventListener('input', previewImport)
$('import-text').addEventListener('paste', (event) => {
  // Tables and website selections paste as HTML; keep their cell structure.
  const html = event.clipboardData.getData('text/html')
  const text = html && htmlToText(html)
  if (!text) return
  event.preventDefault()
  $('import-text').value = text
  previewImport()
})
$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0]
  if (!file) return
  importName = file.name
  const text = await file.text()
  $('import-text').value = /\.html?$/i.test(file.name) ? htmlToText(text) ?? text : text
  previewImport()
})
$('import-dialog').addEventListener('close', () => {
  if ($('import-dialog').returnValue !== 'apply' || !imported) return
  const rundown = imported
  commit((s) => core.replaceRundown(s, rundown))
  dayIndex = 0
  render()
})

// Settings dialog
$('settings-open').addEventListener('click', () => {
  $('setting-yellow').value = state.settings.yellow
  $('setting-red').value = state.settings.red
  $('setting-presets').value = state.settings.presets.join('\n')
  for (const n of [1, 2]) {
    $(`setting-screen-${n}`).replaceChildren(
      ...Object.entries(core.LAYOUTS).map(([layout, label]) =>
        h('option', { value: layout, selected: state.settings.screens[n] === layout }, label)),
    )
  }
  $('settings-dialog').showModal()
})
$('settings-dialog').addEventListener('close', () => {
  if ($('settings-dialog').returnValue !== 'save') return
  commit((s) => {
    s.settings.yellow = Math.max(0, Number($('setting-yellow').value) || 0)
    s.settings.red = Math.max(0, Number($('setting-red').value) || 0)
    s.settings.screens = { 1: $('setting-screen-1').value, 2: $('setting-screen-2').value }
    s.settings.presets = $('setting-presets').value.split('\n').map((line) => line.trim()).filter(Boolean)
  })
})
$('restore-idsw').addEventListener('click', () => {
  if (!confirm('Replace the rundown with the IDSW 2026 schedule? Your edits and logged times are lost.')) return
  commit((s) => core.replaceRundown(s, core.fromSchedule(idsw)))
  dayIndex = 0
  $('settings-dialog').close()
  render()
})

addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.target.closest('dialog, .split-menu')) return
  // Escape hides the message even while typing the next one.
  if (event.target.closest('input, textarea, select') && event.key !== 'Escape') return
  const keys = {
    ' ': () => commit((s, now) => core.toggle(s, now)),
    ArrowRight: () => commit((s, now) => core.step(s, 1, now, { autostart: event.shiftKey })),
    ArrowLeft: () => commit((s, now) => core.step(s, -1, now)),
    '+': () => commit((s) => core.adjust(s, 60000)),
    '=': () => commit((s) => core.adjust(s, 60000)),
    '-': () => commit((s) => core.adjust(s, -60000)),
    f: () => commit((s, now) => core.flash(s, now), { list: false }),
    F: () => commit((s, now) => core.flash(s, now), { list: false }),
    b: () => commit((s) => (s.blackout = !s.blackout), { list: false }),
    B: () => commit((s) => (s.blackout = !s.blackout), { list: false }),
    Escape: () => commit((s) => core.hideMessage(s), { list: false }),
    n: () => commit((s, now) => core.showQueued(s, null, now), { list: false }),
    N: () => commit((s, now) => core.showQueued(s, null, now), { list: false }),
  }
  const action = keys[event.key]
  if (!action) return
  // A focused button would also react to Space, so take focus away first.
  event.preventDefault()
  document.activeElement?.blur()
  action()
})

// Which stage screens the preview shows. A per-device preference, like the splitter.
const PREVIEW_KEY = 'rundown-timer:preview'
function showPreview(which) {
  $('previews').dataset.show = which
  for (const button of document.querySelectorAll('[data-preview]')) {
    button.setAttribute('aria-pressed', String(button.dataset.preview === which))
  }
}
showPreview(['1', '2', 'both'].includes(localStorage.getItem(PREVIEW_KEY)) ? localStorage.getItem(PREVIEW_KEY) : '1')
for (const button of document.querySelectorAll('[data-preview]')) {
  button.addEventListener('click', () => {
    localStorage.setItem(PREVIEW_KEY, button.dataset.preview)
    showPreview(button.dataset.preview)
  })
}

// Panel splitter. The width is a per-device preference, so it lives outside the shared state.
const WIDTH_KEY = 'rundown-timer:control-width'
const splitter = $('splitter')
function setControlWidth(px) {
  const width = Math.round(Math.min(Math.max(px, 360), innerWidth - 380))
  document.documentElement.style.setProperty('--control-width', `${width}px`)
  splitter.setAttribute('aria-valuenow', String(width))
  return width
}
if (Number(localStorage.getItem(WIDTH_KEY))) setControlWidth(Number(localStorage.getItem(WIDTH_KEY)))
splitter.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  splitter.setPointerCapture(event.pointerId)
  splitter.classList.add('dragging')
  document.body.classList.add('resizing')
})
splitter.addEventListener('pointermove', (event) => {
  if (!splitter.hasPointerCapture(event.pointerId)) return
  localStorage.setItem(WIDTH_KEY, String(setControlWidth(event.clientX)))
})
splitter.addEventListener('lostpointercapture', () => {
  splitter.classList.remove('dragging')
  document.body.classList.remove('resizing')
})
splitter.addEventListener('dblclick', () => {
  localStorage.removeItem(WIDTH_KEY)
  document.documentElement.style.removeProperty('--control-width')
})
splitter.addEventListener('keydown', (event) => {
  const step = { ArrowLeft: -40, ArrowRight: 40 }[event.key]
  if (!step) return
  event.preventDefault()
  event.stopPropagation()
  const current = $('splitter').previousElementSibling.getBoundingClientRect().width
  localStorage.setItem(WIDTH_KEY, String(setControlWidth(current + step)))
})

render()
setInterval(tick, 250)
