// Rundown parsing, timer math and state changes. Shared by the controller, the
// stage view and the tests, so nothing in here touches the DOM.

export const STORAGE_KEY = 'rundown-timer:v1'

// Same kinds as the idsw.dev schedule JSON.
export const KINDS = {
  registration: 'Registration',
  opening: 'Opening',
  keynote: 'Keynote',
  talk: 'Talk',
  sponsor: 'Sponsor',
  lightning: 'Lightning talks',
  panel: 'Panel',
  lunch: 'Lunch',
  coffee: 'Coffee break',
  break: 'Break',
  closing: 'Closing',
  session: 'Other',
}
export const BREAK_KINDS = ['lunch', 'coffee', 'break', 'registration']
// Kinds worth a label next to the title; the others already say it in the title.
export const LABELLED_KINDS = ['keynote', 'sponsor', 'lightning', 'panel']
export const PENDING = ['speaker', 'title', 'subject', 'order']

export const DEFAULT_SETTINGS = {
  yellow: 5, // minutes left when the stage timer turns yellow
  red: 1, // minutes left when it turns red
  presets: [
    '5 minutes left',
    'Please wrap up',
    'Time for Q&A',
    'Last question',
    'Please speak closer to the mic',
    'Thank you!',
  ],
  // What each stage window shows: 'full' (title, speaker, clock, next) or 'timer'.
  screens: { 1: 'full', 2: 'timer' },
}
export const LAYOUTS = { full: 'Timer, title, speaker and next', timer: 'Timer only' }

const pad = (n) => String(n).padStart(2, '0')
const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()

export function minutesOf(time) {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(clean(time))
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export function hhmm(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

export const endOf = (item) => hhmm(minutesOf(item.start) + item.duration)

export function clockOf(ms) {
  const date = new Date(ms)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

let counter = 0
export const newId = () =>
  `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

// ---------------------------------------------------------------------------
// Rundown data

export function guessKind({ title = '', speaker = '', label = '' }) {
  const text = `${label} ${title}`
  const rules = [
    [/registration|gate open|registrasi/i, 'registration'],
    [/keynote/i, 'keynote'],
    [/lunch|ishoma/i, 'lunch'],
    [/coffee/i, 'coffee'],
    [/\bbreak\b|istirahat/i, 'break'],
    [/sponsor/i, 'sponsor'],
    [/lightning/i, 'lightning'],
    [/panel/i, 'panel'],
    [/opening|pembukaan/i, 'opening'],
    [/closing|penutup/i, 'closing'],
  ]
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? (speaker ? 'talk' : 'session')
}

// Turns loose entries ({ start, end?, duration?, title, speaker?, kind?, pending?, note? })
// into rundown items. A missing duration comes from the end time, or else from
// the next entry's start. With `expand`, "Lightning Talks (6 @ 5 min)" becomes
// six segments.
export function itemsFrom(entries = [], { expand = false } = {}) {
  const valid = entries.filter((entry) => minutesOf(entry.start) != null)
  return valid.flatMap((entry, i) => {
    const start = minutesOf(entry.start)
    const given = entry.duration == null || entry.duration === '' ? NaN : Number(entry.duration)
    let duration = Number.isFinite(given) ? given : null
    if (duration == null && minutesOf(entry.end) != null) duration = (minutesOf(entry.end) - start + 1440) % 1440
    if (duration == null) duration = valid[i + 1] ? Math.max(0, minutesOf(valid[i + 1].start) - start) : 0

    const title = clean(entry.title)
    const speaker = clean(entry.speaker)
    const item = {
      id: entry.id ? String(entry.id) : newId(),
      start: hhmm(start),
      duration: Math.max(0, Math.round(duration)),
      title,
      speaker,
      kind: Object.hasOwn(KINDS, entry.kind ?? '') ? entry.kind : guessKind({ title, speaker, label: entry.label }),
      pending: PENDING.includes(entry.pending) ? entry.pending : null,
      note: clean(entry.note),
    }

    const lightning = expand && /\((\d+)\s*[@x×]\s*(\d+)\s*min\)/i.exec(title)
    if (!lightning) return [item]
    const count = Number(lightning[1])
    const each = Number(lightning[2])
    const base = title.replace(lightning[0], '').trim()
    return Array.from({ length: count }, (_, n) => ({
      ...item,
      id: newId(),
      start: hhmm(start + n * each),
      duration: each,
      title: `${base} ${n + 1}/${count}`,
      kind: 'lightning',
    }))
  })
}

// Reads the idsw.dev schedule JSON ({ days: [{ day, date, label, sessions }] })
// and this app's own export, which uses the same shape.
export function fromSchedule(json) {
  const days = Array.isArray(json) ? json : json?.days
  if (!Array.isArray(days) || !days.length) throw new Error('No days found in this JSON.')
  return {
    timezone: clean(json?.timezone),
    days: days.map((day, index) => ({
      id: day.id ? String(day.id) : newId(),
      name: clean(day.day ?? day.name) || `Day ${index + 1}`,
      date: clean(day.date),
      label: clean(day.label),
      items: itemsFrom(day.sessions ?? day.items),
    })),
  }
}

export function toSchedule(state) {
  return {
    timezone: state.timezone || undefined,
    days: state.days.map((day) => ({
      day: day.name,
      date: day.date || undefined,
      label: day.label || undefined,
      sessions: day.items.map((item, i) => {
        const next = day.items[i + 1]
        return {
          start: item.start,
          end: endOf(item),
          title: item.title,
          speaker: item.speaker || null,
          kind: item.kind,
          pending: item.pending,
          duration: item.duration,
          transition: next ? Math.max(0, minutesOf(next.start) - minutesOf(item.start) - item.duration) : 0,
          ...(item.note && { note: item.note }),
        }
      }),
    })),
  }
}

// ---------------------------------------------------------------------------
// Pasted text

const TIME_LINE =
  /^(\d{1,2}[:.]\d{2})(?:\s*(?:-|–|—|to|s\.?d\.?)\s*(\d{1,2}[:.]\d{2}))?(?:\s*\(?\s*(\d+)\s*min(?:ute)?s?\s*\)?)?(.*)$/i
const DAY_LINE = /^day\s*\d+\b/i
const DATE_LINE = /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i
const DURATION_LINE = /^(\d+)\s*min(?:ute)?s?$/i
const PENDING_LINE = /^(\w+).*\bto be announced$/i

// One-line descriptions such as "Keynote by Ayu Purwarianti" or
// "Yohan Totting: Under the Hood (Productivity, Deep-dive)".
export function describe(text) {
  const t = clean(text)
  const keynote = /^keynote\s+by\s+(.+)$/i.exec(t)
  if (keynote) return { kind: 'keynote', title: 'Keynote', speaker: keynote[1] }
  const talk = /^([^:\d]{2,40}):\s+(.+)$/.exec(t)
  if (talk && !/sponsor/i.test(talk[1])) {
    const tags = /\s*\(([^()]+)\)$/.exec(talk[2])
    return {
      speaker: talk[1].trim(),
      title: tags ? talk[2].slice(0, tags.index).trim() : talk[2],
      note: tags?.[1] ?? '',
    }
  }
  return { title: t }
}

// Multi-line entries, as copied from the idsw.dev schedule page:
// "45 min", "Keynote", "<title>", "<speaker>", "Title to be announced".
export function describeLines(lines) {
  const rest = []
  const result = { duration: null, pending: null, label: '' }
  for (const line of lines.map(clean).filter(Boolean)) {
    const minutes = DURATION_LINE.exec(line)
    const pending = PENDING_LINE.exec(line)
    if (minutes && result.duration == null) result.duration = Number(minutes[1])
    else if (pending) result.pending = pending[1].toLowerCase()
    else rest.push(line)
  }
  if (rest.length > 1 && /^keynote$/i.test(rest[0])) result.label = rest.shift()
  if (rest.length === 1) return { ...result, ...describe(rest[0]) }
  return { ...result, title: rest[0] ?? '', speaker: rest.slice(1).join(', ') }
}

const entryFrom = (match) => ({
  start: match[1].replace('.', ':'),
  end: match[2]?.replace('.', ':') ?? null,
  duration: match[3] ? Number(match[3]) : null,
})

// Turns pasted text into days. Understands
// - tab-separated tables from Google Docs or Sheets, with several days side by side
//   ("Day 1 | | Day 2 |" header, then "time | session | time | session" rows),
// - one segment per line ("10:00 - 10:05 (5 min) Opening"),
// - blocks where a time range sits on its own line and the details follow.
export function parseText(text) {
  const columns = []
  const startDay = (column, name) => (columns[column] ??= []).push({ name: clean(name), date: '', label: '', entries: [] })
  const dayIn = (column) => {
    if (!columns[column]?.length) startDay(column, '')
    return columns[column].at(-1)
  }
  let block = null

  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim()) continue
    const cells = raw.includes('\t') ? raw.split('\t').map(clean) : [clean(raw)]

    if (cells.length === 1) {
      const line = cells[0]
      const time = TIME_LINE.exec(line)
      if (DAY_LINE.test(line)) {
        startDay(0, line)
        block = null
      } else if (time) {
        const rest = time[4].replace(/^[\s|:\-–—]+/, '')
        const entry = { ...entryFrom(time), ...(rest ? describe(rest) : { lines: [] }) }
        dayIn(0).entries.push(entry)
        block = rest ? null : entry
      } else if (block) {
        block.lines.push(line)
      } else {
        const day = dayIn(0)
        if (!day.entries.length && !day.label && DATE_LINE.test(line)) day.label = line
      }
      continue
    }

    block = null
    for (let column = 0; column * 2 < cells.length; column++) {
      const timeCell = cells[column * 2]
      const titleCell = cells[column * 2 + 1] ?? ''
      if (DAY_LINE.test(timeCell)) startDay(column, timeCell)
      else if (!timeCell && DAY_LINE.test(titleCell)) startDay(column, titleCell)
      else {
        const time = TIME_LINE.exec(timeCell)
        const title = clean(`${time?.[4] ?? ''} ${titleCell}`)
        if (time && title) dayIn(column).entries.push({ ...entryFrom(time), ...describe(title) })
      }
    }
  }

  return columns
    .flat()
    .filter((day) => day.entries.length)
    .map((day, index) => ({
      id: newId(),
      name: day.name || `Day ${index + 1}`,
      date: day.date,
      label: day.label,
      items: itemsFrom(
        day.entries.map(({ lines, ...entry }) => {
          if (!lines) return entry
          const details = describeLines(lines)
          return { ...entry, ...details, duration: entry.duration ?? details.duration }
        }),
        { expand: true },
      ),
    }))
}

// ---------------------------------------------------------------------------
// State

const idleLive = (itemId) => ({ itemId, running: false, startedAt: null, elapsed: 0, adjust: 0 })

export function createState({ timezone = '', days }) {
  return {
    version: 1,
    timezone,
    days,
    settings: structuredClone(DEFAULT_SETTINGS),
    live: idleLive(days[0]?.items[0]?.id ?? null),
    log: {}, // itemId -> { start, end } wall-clock ms of the actual run
    message: { text: '', visible: false, sentAt: 0 },
    queue: [], // messages prepared in advance: { id, text }
    blackout: false,
    flashAt: 0, // when the timekeeper last flashed the stage screens
  }
}

// Fills in anything missing from a stored state, for example after an upgrade.
export function normalize(stored) {
  const { timezone, days } = fromSchedule({ timezone: stored?.timezone, days: stored?.days })
  const base = createState({ timezone, days })
  return {
    ...base,
    ...stored,
    timezone,
    days,
    settings: { ...base.settings, ...stored?.settings, screens: { ...base.settings.screens, ...stored?.settings?.screens } },
    queue: Array.isArray(stored?.queue) ? stored.queue : [],
    live: { ...base.live, ...stored?.live },
    log: { ...stored?.log },
    message: { ...base.message, ...stored?.message },
  }
}

export function findItem(state, id) {
  for (const day of state.days) {
    const index = day.items.findIndex((item) => item.id === id)
    if (index >= 0) return { day, index, item: day.items[index] }
  }
  return null
}

export const currentItem = (state) => findItem(state, state.live.itemId)?.item ?? null

export function neighbour(state, step) {
  const at = findItem(state, state.live.itemId)
  return at?.day.items[at.index + step] ?? null
}

// ---------------------------------------------------------------------------
// Timer math. The timer stores timestamps, not ticks, so every window computes
// the same value and a reload or crash does not lose time.

export const elapsedOf = (live, now) => live.elapsed + (live.running ? now - live.startedAt : 0)
export const totalOf = (item, live) => Math.max(0, item.duration * 60000 + live.adjust)
export const remainingOf = (item, live, now) => totalOf(item, live) - elapsedOf(live, now)
export const hasStarted = (live) => live.running || live.elapsed > 0

// Uses the settings as they are, unless a threshold is as long as the segment.
// That colour would then show from the first second, so it moves to half time.
// With the default 5 minutes, a 5-minute lightning talk turns yellow at 2:30.
export function thresholds(item, settings) {
  const total = item.duration * 60000
  const fit = (minutes) => (minutes * 60000 >= total ? total / 2 : minutes * 60000)
  return { yellow: fit(settings.yellow), red: fit(settings.red) }
}

export function phaseOf(item, live, settings, now) {
  if (!item) return 'idle'
  if (item.duration === 0) return 'countup'
  const left = remainingOf(item, live, now)
  const { yellow, red } = thresholds(item, settings)
  if (left <= 0) return 'over'
  if (left <= red) return 'red'
  if (left <= yellow) return 'yellow'
  return 'normal'
}

// Counts down in whole seconds, rounding up, so a 30-minute timer shows 30:00
// at the start and 00:00 only when time is up. Overtime counts up with a "+".
export function formatTimer(ms) {
  const over = ms < 0
  const total = over ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000)
  return (over ? '+' : '') + formatSeconds(total)
}

export function formatSeconds(total) {
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

// How far the event runs behind (positive) or ahead (negative) of the planned
// times, in ms. Uses today's date with the rundown's clock times, so rehearsals
// on another day still work. Returns null when the gap is too large to mean anything.
export function scheduleDelta(state, now) {
  const item = currentItem(state)
  if (!item) return null
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  const plannedStart = midnight + minutesOf(item.start) * 60000
  const delta = hasStarted(state.live)
    ? now + Math.max(0, remainingOf(item, state.live, now)) - (plannedStart + item.duration * 60000)
    : now - plannedStart
  return Math.abs(delta) < 4 * 3600000 ? delta : null
}

// "1 min 30 s", for amounts added to or removed from a timer.
export function formatAmount(ms) {
  const total = Math.round(Math.abs(ms) / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return [minutes && `${minutes} min`, seconds && `${seconds} s`].filter(Boolean).join(' ') || '0 s'
}

export function formatDelta(ms) {
  const minutes = Math.round(Math.abs(ms) / 60000)
  if (minutes === 0) return 'On time'
  return `${minutes} min ${ms > 0 ? 'behind' : 'ahead'}`
}

// ---------------------------------------------------------------------------
// Actions. Each one changes a draft copy of the state in place.

function leave(state, now) {
  const entry = state.log[state.live.itemId]
  if (entry && state.live.running) entry.end = now
}

export function load(state, itemId, now) {
  if (state.live.itemId === itemId || !findItem(state, itemId)) return
  leave(state, now)
  state.live = idleLive(itemId)
}

export function start(state, now) {
  const live = state.live
  if (!findItem(state, live.itemId) || live.running) return
  live.running = true
  live.startedAt = now
  const entry = (state.log[live.itemId] ??= { start: now, end: null })
  entry.end = null
}

export function pause(state, now) {
  const live = state.live
  if (!live.running) return
  live.elapsed += now - live.startedAt
  live.running = false
  live.startedAt = null
  if (state.log[live.itemId]) state.log[live.itemId].end = now
}

export function unload(state, now) {
  leave(state, now)
  state.live = idleLive(null)
}

export function toggle(state, now) {
  if (state.live.running) pause(state, now)
  else start(state, now)
}

export function reset(state) {
  delete state.log[state.live.itemId]
  state.live = idleLive(state.live.itemId)
}

export function adjust(state, ms) {
  const item = currentItem(state)
  if (!item) return
  state.live.adjust = Math.max(-item.duration * 60000, state.live.adjust + ms)
}

export function step(state, direction, now, { autostart = false } = {}) {
  const target = neighbour(state, direction)
  if (!target) return
  load(state, target.id, now)
  if (autostart) start(state, now)
}

export function showMessage(state, text, now) {
  state.message = { text: clean(text), visible: Boolean(clean(text)), sentAt: now }
}

export function hideMessage(state) {
  state.message.visible = false
}

export function flash(state, now) {
  state.flashAt = now
}

export function queueMessage(state, text) {
  if (clean(text)) state.queue.push({ id: newId(), text: clean(text) })
}

// Shows a queued message and takes it off the queue. Without an id, shows the first one.
export function showQueued(state, id, now) {
  const index = id ? state.queue.findIndex((entry) => entry.id === id) : 0
  const [entry] = index >= 0 ? state.queue.splice(index, 1) : []
  if (entry) showMessage(state, entry.text, now)
}

export function unqueue(state, id) {
  state.queue = state.queue.filter((entry) => entry.id !== id)
}

export function moveQueued(state, id, direction) {
  const index = state.queue.findIndex((entry) => entry.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= state.queue.length) return
  ;[state.queue[index], state.queue[target]] = [state.queue[target], state.queue[index]]
}

export function replaceRundown(state, { timezone, days }) {
  state.timezone = timezone || state.timezone
  state.days = days
  state.live = idleLive(days[0]?.items[0]?.id ?? null)
  state.log = {}
}

// Splits a segment into equal parts, for example a lightning talk block.
export function splitItem(state, itemId, parts) {
  const at = findItem(state, itemId)
  if (!at || parts < 2) return
  const { item } = at
  const each = Math.floor(item.duration / parts)
  const base = item.title.replace(/\s+\d+\/\d+$/, '')
  const pieces = Array.from({ length: parts }, (_, n) => ({
    ...item,
    id: n === 0 ? item.id : newId(),
    start: hhmm(minutesOf(item.start) + n * each),
    duration: n === parts - 1 ? item.duration - each * (parts - 1) : each,
    title: `${base} ${n + 1}/${parts}`,
    pending: null,
  }))
  at.day.items.splice(at.index, 1, ...pieces)
}

export function sortItems(day) {
  day.items.sort((a, b) => minutesOf(a.start) - minutesOf(b.start))
}
