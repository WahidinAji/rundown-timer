import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as core from '../src/core.js'
import idsw from '../src/idsw-2026.js'

const brief = (item) => [item.start, item.duration, item.kind, item.title, item.speaker]

test('reads the idsw.dev schedule JSON', () => {
  const { timezone, days } = core.fromSchedule(idsw)
  assert.equal(timezone, 'Asia/Jakarta')
  assert.deepEqual(days.map((day) => [day.name, day.date, day.items.length]), [
    ['Day 1', '2026-11-21', 15],
    ['Day 2', '2026-11-22', 13],
  ])
  const keynote = days[0].items[3]
  assert.deepEqual(brief(keynote), ['09:45', 45, 'keynote', keynote.title, 'Muqorrobin Marufi Syihab (Robin)'])
  assert.equal(days[0].items[2].pending, 'speaker')
  assert.equal(days[1].items[8].kind, 'lightning')
})

test('exports the same schedule JSON it reads', () => {
  const state = core.createState(core.fromSchedule(idsw))
  const exported = core.toSchedule(state)
  assert.deepEqual(JSON.parse(JSON.stringify(exported)), idsw)
})

// Last year's rundown, copied from the Google Docs table (two days side by side).
const TABLE_2025 = [
  'Day 1 (Nov 22)\t\tDay 2 (Nov 23)\t',
  '09:00\tGate open (registration)\t09:30\tGate open (registration)',
  '10:00 - 10:05 (5 min)\tOpening\t10:00 - 10:05 (5 min)\tOpening',
  '10:10 - 10:30 (20 min)\tOur sponsors: SerpApi\t10:10 - 10:30 (20 min)\tOur sponsors: Amartha',
  '10:35 - 11:20 (45 min)\tKeynote by Pahlevi Fikri Auliya\t10:35 - 11:20 (45 min)\tKeynote by Sandhika Galih',
  '11:25 - 11:55 (30 min)\tYohan Totting: Under the Hood: Building AI Coding Assistants (Productivity, Deep-dive)\t11:25 - 11:55 (30 min)\tIskandar Soesman: Building Production-Ready Infrastructure Tools 10x Faster with AI Agents: The Vapor Story (Productivity)',
  '12:30 - 13:40 (70 min)\tLunch Break\t12:30 - 13:55 (85 min)\tIcebreaking + Lunch Break',
  '15:30 - 16:00 (30 min)\tRenaldi Gondosubroto: Certified Answers for RAG (Research, Deep-dive)\t15:30 - 16:00 (30 min)\tLightning Talks (6 @ 5 min)',
  '16:30 - 17:30 (60 min)\tDiscussion Panel with Bagas & Gogo\t16:55 - 17:05 (15 min)\tDoorprize Announcement',
  '17:30\tClosing Remark\t17:05\tClosing Remark',
].join('\n')

test('parses a two-column-per-day table from Google Docs', () => {
  const days = core.parseText(TABLE_2025)
  assert.deepEqual(days.map((day) => [day.name, day.items.length]), [
    ['Day 1 (Nov 22)', 9],
    ['Day 2 (Nov 23)', 14],
  ])
  const [one, two] = days
  assert.deepEqual(brief(one.items[0]), ['09:00', 60, 'registration', 'Gate open (registration)', ''])
  assert.deepEqual(brief(one.items[2]), ['10:10', 20, 'sponsor', 'Our sponsors: SerpApi', ''])
  assert.deepEqual(brief(one.items[3]), ['10:35', 45, 'keynote', 'Keynote', 'Pahlevi Fikri Auliya'])
  assert.deepEqual(brief(one.items[4]), ['11:25', 30, 'talk', 'Under the Hood: Building AI Coding Assistants', 'Yohan Totting'])
  assert.equal(one.items[4].note, 'Productivity, Deep-dive')
  assert.equal(one.items[5].kind, 'lunch')
  assert.equal(one.items[7].kind, 'panel')
  assert.deepEqual(brief(one.items[8]), ['17:30', 0, 'closing', 'Closing Remark', ''])
  assert.equal(two.items[5].duration, 85)
  const lightning = two.items.filter((item) => item.kind === 'lightning')
  assert.deepEqual(lightning.map((item) => item.start), ['15:30', '15:35', '15:40', '15:45', '15:50', '15:55'])
  assert.equal(lightning[5].title, 'Lightning Talks 6/6')
})

// Text selected and copied from the idsw.dev schedule section.
const WEBSITE_TEXT = `Day 1
21 November 2026
08:00 – 09:00
60 min
Registration
09:20 – 09:40
20 min
Sponsor Talk A
Speaker to be announced
09:45 – 10:30
45 min
KEYNOTE
Run your organization with agentic AI powered by local LLMs
Muqorrobin Marufi Syihab (Robin)
Day 2
22 November 2026
13:30 – 14:15
45 min
Keynote
Keynote
Eko Kurniawan Khannedy
Title to be announced
14:20 – 15:20
60 min
Lightning talks
Order to be announced`

test('parses text copied from the website schedule', () => {
  const days = core.parseText(WEBSITE_TEXT)
  assert.deepEqual(days.map((day) => [day.name, day.label, day.items.length]), [
    ['Day 1', '21 November 2026', 3],
    ['Day 2', '22 November 2026', 2],
  ])
  assert.deepEqual(brief(days[0].items[1]), ['09:20', 20, 'sponsor', 'Sponsor Talk A', ''])
  assert.equal(days[0].items[1].pending, 'speaker')
  assert.deepEqual(brief(days[0].items[2]), ['09:45', 45, 'keynote', 'Run your organization with agentic AI powered by local LLMs', 'Muqorrobin Marufi Syihab (Robin)'])
  assert.deepEqual(brief(days[1].items[0]), ['13:30', 45, 'keynote', 'Keynote', 'Eko Kurniawan Khannedy'])
  assert.equal(days[1].items[0].pending, 'title')
  assert.deepEqual(brief(days[1].items[1]), ['14:20', 60, 'lightning', 'Lightning talks', ''])
})

test('parses one segment per line', () => {
  const [day] = core.parseText('10:00 Opening\n10.05-10.35 Talk one\n10:40 Closing')
  assert.deepEqual(day.items.map(brief), [
    ['10:00', 5, 'opening', 'Opening', ''],
    ['10:05', 30, 'session', 'Talk one', ''],
    ['10:40', 0, 'closing', 'Closing', ''],
  ])
})

const minute = 60000

function liveState() {
  const state = core.createState(core.fromSchedule(idsw))
  const keynote = state.days[0].items[3]
  core.load(state, keynote.id, 0)
  return { state, keynote }
}

test('counts down, pauses and resumes', () => {
  const { state, keynote } = liveState()
  core.start(state, 1000)
  assert.equal(core.formatTimer(core.remainingOf(keynote, state.live, 1000)), '45:00')
  assert.equal(core.formatTimer(core.remainingOf(keynote, state.live, 1500)), '45:00')
  assert.equal(core.formatTimer(core.remainingOf(keynote, state.live, 2000)), '44:59')
  core.pause(state, 1000 + 10 * minute)
  assert.equal(core.formatTimer(core.remainingOf(keynote, state.live, 1000 + 50 * minute)), '35:00')
  core.start(state, 100 * minute)
  core.adjust(state, minute)
  assert.equal(core.formatTimer(core.remainingOf(keynote, state.live, 100 * minute)), '36:00')
})

test('turns yellow, red, then counts overtime with a plus', () => {
  const { state, keynote } = liveState()
  const at = (ms) => core.phaseOf(keynote, state.live, state.settings, ms)
  core.start(state, 0)
  assert.equal(at(39 * minute), 'normal')
  assert.equal(at(40 * minute), 'yellow')
  assert.equal(at(44 * minute), 'red')
  assert.equal(at(45 * minute), 'over')
  assert.equal(core.formatTimer(core.remainingOf(keynote, state.live, 47 * minute + 5000)), '+02:05')
})

test('moves a warning to half time only when it is as long as the segment', () => {
  const item = { duration: 5 }
  assert.deepEqual(core.thresholds(item, core.DEFAULT_SETTINGS), { yellow: 2.5 * minute, red: minute })
})

test('uses the settings as they are for longer segments', () => {
  // The Opening is 15 minutes, with yellow at 14 and red at 13.
  const opening = { duration: 15 }
  const settings = { ...core.DEFAULT_SETTINGS, yellow: 14, red: 13 }
  assert.deepEqual(core.thresholds(opening, settings), { yellow: 14 * minute, red: 13 * minute })
  const live = { running: true, startedAt: 0, elapsed: 0, adjust: 0 }
  const at = (ms) => core.phaseOf(opening, live, settings, ms)
  assert.equal(at(59 * 1000), 'normal')
  assert.equal(at(60 * 1000 + 44 * 1000), 'yellow') // 13:16 left
  assert.equal(at(2 * minute), 'red')
})

test('steps through the rundown and logs actual times', () => {
  const { state, keynote } = liveState()
  core.start(state, 5)
  core.step(state, 1, 50, { autostart: true })
  assert.equal(core.currentItem(state).speaker, 'Iman Fattah')
  assert.deepEqual(state.log[keynote.id], { start: 5, end: 50 })
  assert.equal(state.live.running, true)
  core.step(state, -1, 60)
  assert.equal(core.currentItem(state), keynote)
  assert.equal(state.live.running, false)
})

test('reports how far behind schedule the event runs', () => {
  const { state } = liveState()
  const day = new Date(2026, 10, 21).getTime()
  // Keynote planned 09:45-10:30, started at 09:47.
  core.start(state, day + (9 * 60 + 47) * minute)
  const delta = core.scheduleDelta(state, day + (10 * 60) * minute)
  assert.equal(core.formatDelta(delta), '2 min behind')
  core.adjust(state, -5 * minute)
  assert.equal(core.formatDelta(core.scheduleDelta(state, day + (10 * 60) * minute)), '3 min ahead')
})

test('splits a lightning talk block into equal parts', () => {
  const state = core.createState(core.fromSchedule(idsw))
  const block = state.days[1].items[8]
  core.splitItem(state, block.id, 6)
  const parts = state.days[1].items.slice(8, 14)
  assert.deepEqual(parts.map((item) => [item.start, item.duration, item.title]), [
    ['14:20', 10, 'Lightning talks 1/6'],
    ['14:30', 10, 'Lightning talks 2/6'],
    ['14:40', 10, 'Lightning talks 3/6'],
    ['14:50', 10, 'Lightning talks 4/6'],
    ['15:00', 10, 'Lightning talks 5/6'],
    ['15:10', 10, 'Lightning talks 6/6'],
  ])
  assert.equal(state.days[1].items[14].title, 'Coffee Break')
})

test('restores a stored state and fills in new settings', () => {
  const state = core.createState(core.fromSchedule(idsw))
  delete state.settings.presets
  const restored = core.normalize(JSON.parse(JSON.stringify(state)))
  assert.deepEqual(restored.settings.presets, core.DEFAULT_SETTINGS.presets)
  assert.deepEqual(restored.days, state.days)
})

test('queues messages and shows them in order', () => {
  const state = core.createState(core.fromSchedule(idsw))
  core.queueMessage(state, 'Robin: 10 minutes left')
  core.queueMessage(state, '  ')
  core.queueMessage(state, 'Q&A starts now')
  core.queueMessage(state, 'Thank you, Robin!')
  assert.equal(state.queue.length, 3)
  core.moveQueued(state, state.queue[2].id, -1)
  assert.deepEqual(state.queue.map((entry) => entry.text), ['Robin: 10 minutes left', 'Thank you, Robin!', 'Q&A starts now'])
  core.showQueued(state, null, 100)
  assert.deepEqual(state.message, { text: 'Robin: 10 minutes left', visible: true, sentAt: 100 })
  core.showQueued(state, state.queue[1].id, 200)
  assert.equal(state.message.text, 'Q&A starts now')
  core.unqueue(state, state.queue[0].id)
  assert.deepEqual(state.queue, [])
})

test('records when the stage was flashed', () => {
  const state = core.createState(core.fromSchedule(idsw))
  assert.equal(state.flashAt, 0)
  core.flash(state, 1234)
  assert.equal(core.normalize(JSON.parse(JSON.stringify(state))).flashAt, 1234)
})

test('gives older stored states a queue and screen layouts', () => {
  const state = core.createState(core.fromSchedule(idsw))
  delete state.queue
  delete state.settings.screens
  const restored = core.normalize(JSON.parse(JSON.stringify(state)))
  assert.deepEqual(restored.queue, [])
  assert.deepEqual(restored.settings.screens, { 1: 'full', 2: 'timer' })
})
