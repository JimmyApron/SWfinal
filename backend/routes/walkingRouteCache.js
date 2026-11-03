// Temporary, bounded server memory. Concurrent identical lookups share one request.
function createWalkingRouteCache({ ttlMs = 15 * 60 * 1000, maxEntries = 500, now = Date.now } = {}) {
  const entries = new Map()
  const pending = new Map()
  return async function lookup(key, load) {
    const cached = entries.get(key)
    if (cached && cached.expiresAt > now()) return cached.result
    entries.delete(key)
    if (pending.has(key)) return pending.get(key)
    const task = Promise.resolve().then(load).then(result => {
      if (result.status === 200) {
        for (const [entryKey, entry] of entries) {
          if (entry.expiresAt <= now()) entries.delete(entryKey)
        }
        while (entries.size >= maxEntries) entries.delete(entries.keys().next().value)
        entries.set(key, { result, expiresAt: now() + ttlMs })
      }
      return result
    }).finally(() => pending.delete(key))
    pending.set(key, task)
    return task
  }
}
module.exports = { createWalkingRouteCache }
