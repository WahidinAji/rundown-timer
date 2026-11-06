// The controller writes the whole state to localStorage. Stage windows on the
// same origin get a `storage` event for every write, so no server push is needed.
import { STORAGE_KEY, normalize } from './core.js'

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? normalize(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function onExternalChange(listener) {
  addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try {
      listener(normalize(JSON.parse(event.newValue)))
    } catch {
      // Ignore a half-written or foreign value; the next write fixes it.
    }
  })
}
