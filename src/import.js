// Import helpers that need the browser. They turn HTML and CSV into the plain
// text that core.parseText understands, and pick the right reader for a pasted value.
import { fromSchedule, parseText } from './core.js'

const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim()

// textContent without layout, but with spaces where paragraphs and line breaks were.
function textOf(element) {
  const copy = element.cloneNode(true)
  copy.querySelectorAll('br, p, div, li').forEach((node) => node.after(' '))
  return clean(copy.textContent)
}

// A schedule <article> from idsw.dev becomes the same lines you get by
// selecting and copying the schedule on the website.
function articleText(article) {
  const lines = [textOf(article.querySelector('h3'))]
  const date = [...article.querySelectorAll('time')].find((time) => !time.closest('li'))
  if (date) lines.push(textOf(date))
  for (const li of article.querySelectorAll('li')) {
    lines.push([...li.querySelectorAll('time')].map(textOf).join(' - '))
    for (const node of li.querySelectorAll('p, span')) {
      if (!node.querySelector('p, span, time') && !node.closest('time')) lines.push(textOf(node))
    }
  }
  return lines.join('\n')
}

const tableText = (table) =>
  [...table.rows].map((row) => [...row.cells].map(textOf).join('\t')).join('\n')

// Returns importable text for pasted or saved HTML, or null if it has no schedule.
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const articles = [...doc.querySelectorAll('article')].filter((article) => article.querySelector('h3') && article.querySelector('li time'))
  if (articles.length) return articles.map(articleText).join('\n')
  const tables = [...doc.querySelectorAll('table')]
  if (tables.length) return tables.map(tableText).join('\n')
  return null
}

export function csvToTsv(csv) {
  const rows = [[]]
  let cell = ''
  let quoted = false
  const endCell = () => {
    rows.at(-1).push(cell)
    cell = ''
  }
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    if (quoted && char === '"' && csv[i + 1] === '"') {
      cell += '"'
      i++
    } else if (char === '"') {
      quoted = !quoted
    } else if (quoted || (char !== ',' && char !== '\n' && char !== '\r')) {
      cell += char
    } else if (char === ',') {
      endCell()
    } else if (char === '\n') {
      endCell()
      rows.push([])
    }
  }
  endCell()
  return rows.map((row) => row.map(clean).join('\t')).join('\n')
}

// Returns { timezone, days }. Throws an Error with a message for the user.
export function readRundown(text, fileName = '') {
  const value = text.trim()
  if (!value) throw new Error('Paste a schedule or choose a file.')
  if (/^[[{]/.test(value)) {
    let json
    try {
      json = JSON.parse(value)
    } catch (error) {
      throw new Error(`This JSON has an error: ${error.message}`)
    }
    return fromSchedule(json)
  }
  const source = /<\/?[a-z][^>]*>/i.test(value) ? htmlToText(value) ?? '' : /\.csv$/i.test(fileName) ? csvToTsv(value) : value
  const days = parseText(source)
  if (!days.length) throw new Error('No times found. Each segment needs a start time such as 09:45.')
  return { days }
}
