// The on-device store for map files. Everything the map asks its tile server
// for passes through here: a file already on the device is used at once, so the
// map opens quickly and saved places work without a connection; anything else
// is fetched and kept for next time.
//
// Three stores (browser Cache Storage, which the Android app has too):
//   saved   files of places the user saved; only removed when a place is
//   recent  whatever the map loaded lately; the oldest are dropped
//   data    small JSON answers (forecasts), each with the time it was saved

import { storeKey, storePolicy, TILE_HOST } from './offlineArea'

/** Addresses rewritten to this scheme are answered by `loadFromStore`. */
export const STORE_PROTOCOL = 'ofm'

const SAVED = 'sunspot-saved-v1'
const RECENT = 'sunspot-recent-v1'
const DATA = 'sunspot-data-v1'
/** Files kept in `recent`; a city view uses a few dozen. */
const RECENT_LIMIT = 600
/** How long the style may take from the network before the stored copy is used. */
const FRESH_TIMEOUT_MS = 2500
/** Files fetched side by side while saving a place. */
const SAVE_CONCURRENCY = 6

/** False in old browsers, on insecure pages and in tests: everything then goes straight to the network. */
const hasStore = () => typeof caches !== 'undefined'

/** The store address for a tile-server file, or null for anything else. */
export function toStoreUrl(url: string): string | null {
  return url.startsWith(TILE_HOST) ? `${STORE_PROTOCOL}://${url.slice('https://'.length)}` : null
}

export function fromStoreUrl(url: string): string {
  return `https://${url.slice(`${STORE_PROTOCOL}://`.length)}`
}

async function lookup(key: string): Promise<Response | undefined> {
  return (await (await caches.open(SAVED)).match(key)) ?? (await (await caches.open(RECENT)).match(key))
}

let remembered = 0

async function remember(key: string, response: Response): Promise<void> {
  const recent = await caches.open(RECENT)
  await recent.put(key, response)
  // Counting every entry on every write would be slow; check now and then.
  if (++remembered % 50 !== 0) return
  const keys = await recent.keys()
  // Keys come back oldest first.
  for (const request of keys.slice(0, Math.max(0, keys.length - RECENT_LIMIT))) await recent.delete(request)
}

/** A signal that also fires after `ms`, so a slow network does not hold the map up. */
function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const forward = () => controller.abort()
  signal?.addEventListener('abort', forward)
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forward)
    },
  }
}

/** Fetch a tile-server file through the store (see `StorePolicy` for the order). */
export async function storedFetch(url: string, signal?: AbortSignal): Promise<Response> {
  if (!hasStore()) return fetch(url, { signal })
  const key = storeKey(url)
  const fresh = storePolicy(url) === 'fresh'
  const hit = await lookup(key)
  if (hit && !fresh) return hit

  const limit = hit ? withTimeout(signal, FRESH_TIMEOUT_MS) : null
  try {
    const response = await fetch(url, { signal: limit?.signal ?? signal })
    if (response.ok) void remember(key, response.clone()).catch(() => {})
    else if (hit) return hit
    return response
  } catch (error) {
    // No network, or too slow: the stored copy will do. A cancelled request stays cancelled.
    if (hit && !signal?.aborted) return hit
    throw error
  } finally {
    limit?.done()
  }
}

/** What MapLibre hands a custom protocol, and what it expects back. */
interface ProtocolRequest {
  url: string
  type?: string
}

/** MapLibre protocol handler: answers map requests from the store. */
export async function loadFromStore(
  request: ProtocolRequest,
  abortController: AbortController,
): Promise<{ data: ArrayBuffer | ImageBitmap | string | object }> {
  const url = fromStoreUrl(request.url)
  const response = await storedFetch(url, abortController.signal)
  if (!response.ok) throw new Error(`Map file not available (${response.status}): ${url}`)
  switch (request.type) {
    case 'json':
      return { data: (await response.json()) as object }
    case 'string':
      return { data: await response.text() }
    case 'image':
      return { data: await createImageBitmap(await response.blob()) }
    default:
      return { data: await response.arrayBuffer() }
  }
}

export interface SaveResult {
  /** Store names of the files now saved, for removing them again later. */
  keys: string[]
  bytes: number
  /** Files that could not be fetched. */
  failed: number
}

/**
 * Put files into the saved store, fetching the ones not on the device yet.
 * `onProgress` is called after each file with how many are done.
 */
export async function saveToStore(
  urls: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<SaveResult> {
  const result: SaveResult = { keys: [], bytes: 0, failed: 0 }
  if (!hasStore()) return { ...result, failed: urls.length }
  const saved = await caches.open(SAVED)
  const recent = await caches.open(RECENT)
  let next = 0
  let done = 0

  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++]
      const key = storeKey(url)
      try {
        let response = await saved.match(key)
        if (!response) {
          response = (await recent.match(key)) ?? (await fetch(url))
          // "Nothing here" (open sea, say) is an answer, not a failure.
          if (response.ok) await saved.put(key, response.clone())
          else if (response.status !== 404 && response.status !== 204) result.failed++
        }
        if (response.ok) {
          result.keys.push(key)
          result.bytes += (await response.blob()).size
        }
      } catch {
        result.failed++
      }
      onProgress?.(++done, urls.length)
    }
  }
  await Promise.all(Array.from({ length: SAVE_CONCURRENCY }, worker))
  return result
}

export async function removeFromStore(keys: string[]): Promise<void> {
  if (!hasStore()) return
  const saved = await caches.open(SAVED)
  await Promise.all(keys.map((key) => saved.delete(key)))
}

/** Ask the system not to clear this app's storage when the device runs low. Best effort. */
export function keepStorage(): void {
  void navigator.storage?.persist?.().catch(() => {})
}

/** Keep a JSON answer under `key` (an address), stamped with the time. */
export async function rememberJson(key: string, data: unknown): Promise<void> {
  if (!hasStore()) return
  try {
    const body = JSON.stringify({ savedAt: new Date().toISOString(), data })
    await (await caches.open(DATA)).put(key, new Response(body, { headers: { 'content-type': 'application/json' } }))
  } catch {
    // Storage full or blocked: the answer is still used this time.
  }
}

/** A JSON answer kept earlier, with when it was saved; null when there is none. */
export async function recallJson<T>(key: string): Promise<{ savedAt: string; data: T } | null> {
  if (!hasStore()) return null
  try {
    const response = await (await caches.open(DATA)).match(key)
    return response ? ((await response.json()) as { savedAt: string; data: T }) : null
  } catch {
    return null
  }
}
