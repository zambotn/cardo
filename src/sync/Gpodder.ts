import { GpodderUpdate, ProtocolFn, ServerGpodderUpdate, SubscriptionsUpdate } from '.'
import * as http from '@tauri-apps/plugin-http'

function getServerUrl(server: string) {
  const normalizedServer = /^https?:\/\//i.test(server.trim()) ? server.trim() : `https://${server.trim()}`
  return new URL(normalizedServer)
}

function buildApiUrl(server: string, apiPath: string) {
  const baseUrl = getServerUrl(server)
  const url = new URL(baseUrl.href)
  const basePath = baseUrl.pathname.replace(/\/+$/, '')
  url.pathname = `${basePath}${apiPath}`.replace(/\/{2,}/g, '/')
  return url
}

function encodeBase64Utf8(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function authHeader(user: string, password: string) {
  return 'Basic ' + encodeBase64Utf8(`${user}:${password}`)
}

export interface GpodderDevice {
  id: string
  caption?: string
  type?: string
  subscriptions?: number
}

function ensureCredentials(url: string, user: string, password: string) {
  if (!url.trim() || !user.trim() || !password) {
    throw new Error('Missing server, username, or password')
  }
}

function normalizeDeviceResponse(data: unknown): GpodderDevice[] {
  if (!Array.isArray(data)) return []

  const devices: GpodderDevice[] = []

  for (const device of data) {
    if (typeof device !== 'object' || device === null) continue

    const record = device as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : typeof record.deviceid === 'string' ? record.deviceid : ''

    if (!id) continue

    devices.push({
      id,
      caption: typeof record.caption === 'string' ? record.caption : undefined,
      type: typeof record.type === 'string' ? record.type : undefined,
      subscriptions: typeof record.subscriptions === 'number' ? record.subscriptions : undefined,
    })
  }

  return devices
}

export function normalizeDeviceId(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w.-]/g, '')
    .replace(/^-+|-+$/g, '')
}

export async function login(url: string, user: string, password: string): Promise<boolean> {
  ensureCredentials(url, user, password)

  // just returns true if login was successful
  const loginUrl = buildApiUrl(url, `/api/2/auth/${encodeURIComponent(user)}/login.json`)

  const r = await http.fetch(loginUrl.href, {
    method: 'POST',
    headers: {
      Authorization: authHeader(user, password),
    },
  })

  return r.ok
}

export async function listDevices(url: string, user: string, password: string): Promise<GpodderDevice[]> {
  ensureCredentials(url, user, password)

  const devicesUrl = buildApiUrl(url, `/api/2/devices/${encodeURIComponent(user)}.json`)
  const response = await http.fetch(devicesUrl.href, {
    method: 'GET',
    headers: {
      Authorization: authHeader(user, password),
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error('Failed to load gpodder devices')
  }

  return normalizeDeviceResponse(await response.json())
}

export async function createOrUpdateDevice(
  url: string,
  user: string,
  password: string,
  deviceName: string,
  caption: string,
) {
  ensureCredentials(url, user, password)

  if (!deviceName.trim()) {
    throw new Error('Device name is required')
  }

  const deviceUrl = buildApiUrl(
    url,
    `/api/2/devices/${encodeURIComponent(user)}/${encodeURIComponent(deviceName)}.json`,
  )
  const response = await http.fetch(deviceUrl.href, {
    method: 'POST',
    headers: {
      Authorization: authHeader(user, password),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      caption: caption.trim() || deviceName,
      type: 'desktop',
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to create gpodder device')
  }
}

export const gpodderProtocol: ProtocolFn = function (creds) {
  async function pullEpisodes(since?: number) {
    const { server, user, password } = creds

    const url = buildApiUrl(server, `/api/2/episodes/${encodeURIComponent(user)}.json`)

    if (since !== undefined) {
      url.searchParams.set('since', since.toString())
    }

    url.searchParams.set('aggregated', 'true')

    const r = await http.fetch(url.href, {
      method: 'GET',
      headers: {
        Authorization: authHeader(user, password),
        'Content-Type': 'application/json',
      },
    })

    const data: { actions: ServerGpodderUpdate[] } = await r.json()

    return data.actions.map((update: ServerGpodderUpdate) => ({
      ...update,
      timestamp: new Date(update.timestamp).getTime(), //timestamp in epoch format (server is in utc ISO format)
    }))
  }

  async function pullSubscriptions(since?: number): Promise<SubscriptionsUpdate> {
    const { server, user, password, deviceName } = creds

    if (!deviceName) {
      throw Error('Missing gpodder device configuration')
    }

    const url = buildApiUrl(server, `/api/2/subscriptions/${encodeURIComponent(user)}/${encodeURIComponent(deviceName)}.json`)

    if (since !== undefined) {
      url.searchParams.set('since', since.toString())
    }

    const r = await http.fetch(url.href, {
      method: 'GET',
      headers: {
        Authorization: authHeader(user, password),
        'Content-Type': 'application/json',
      },
    })

    return r.json()
  }

  async function pushEpisodes(updates: GpodderUpdate[]) {
    const { server, user, password, deviceName } = creds

    const url = buildApiUrl(server, `/api/2/episodes/${encodeURIComponent(user)}.json`)

    const r = await http.fetch(url.href, {
      method: 'POST',
      headers: {
        Authorization: authHeader(user, password),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        updates.map((update) => ({
          ...update,
          device: deviceName,
          timestamp: new Date(update.timestamp).toISOString(),
        })),
      ),
    })

    if (!r.ok) {
      throw Error(`Failed pushing episodes to gpodder server (${r.status})`)
    }
  }

  async function pushSubscriptions(updates: SubscriptionsUpdate) {
    const { server, user, password, deviceName } = creds

    if (!deviceName) {
      throw Error('Missing gpodder device configuration')
    }

    const url = buildApiUrl(
      server,
      `/api/2/subscriptions/${encodeURIComponent(user)}/${encodeURIComponent(deviceName)}.json`,
    )

    const r = await http.fetch(url.href, {
      method: 'POST',
      headers: {
        Authorization: authHeader(user, password),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    })

    if (!r.ok) {
      throw Error('Failed pushing subscriptions to gpodder server')
    }
  }

  return { login, pullEpisodes, pullSubscriptions, pushEpisodes, pushSubscriptions }
}
