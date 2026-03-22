import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { checkURLScheme, saveCreds, toastError } from '../../utils/utils'
import { useMisc, useSync } from '../../ContextProviders'
import { invoke } from '@tauri-apps/api/core'
import { createOrUpdateDevice, GpodderDevice, listDevices, login, normalizeDeviceId } from '../../sync/Gpodder'
import gpodderLogo from '../../assets/gpodder.png'

export function GpodderSettings() {
  const { t } = useTranslation()
  const { setLoggedIn } = useSync()
  const { getSyncKey, setSyncKey } = useMisc()
  const [server, setServer] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [verifiedServer, setVerifiedServer] = useState('')
  const [verifiedUser, setVerifiedUser] = useState('')
  const [verifiedPassword, setVerifiedPassword] = useState('')
  const [devices, setDevices] = useState<GpodderDevice[]>([])
  const [selectedMode, setSelectedMode] = useState<'existing' | 'new'>('existing')
  const [selectedDevice, setSelectedDevice] = useState('')
  const [newDeviceName, setNewDeviceName] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const credentialsVerified = Boolean(verifiedServer && verifiedUser && verifiedPassword)

  async function persistCredentials(deviceName: string) {
    const parsedServer = new URL(verifiedServer)
    const normalizedServer = `${parsedServer.origin}${parsedServer.pathname}`.replace(/\/+$/, '')

    let key = await getSyncKey()

    if (key === undefined) {
      key = await invoke('generate_key')
      if (key) await setSyncKey(key)
    }

    await saveCreds('gpodder', {
      server: normalizedServer,
      loginName: await invoke('encrypt', { text: verifiedUser, base64Key: key }),
      appPassword: await invoke('encrypt', { text: verifiedPassword, base64Key: key }),
      deviceName,
    })

    setLoggedIn('gpodder')
  }

  async function verifyCredentials() {
    setIsVerifying(true)

    try {
      const authenticated = await login(server, user, password)

      if (!authenticated) {
        toastError(t('login_failed'))
        return
      }

      const availableDevices = await listDevices(server, user, password)
      setDevices(availableDevices)
      setSelectedMode(availableDevices.length > 0 ? 'existing' : 'new')
      setSelectedDevice(availableDevices[0]?.id ?? '')
      setVerifiedServer(server)
      setVerifiedUser(user)
      setVerifiedPassword(password)
    } catch (error) {
      toastError((error as Error).message || t('login_failed'))
    } finally {
      setIsVerifying(false)
    }
  }

  async function handleDeviceSubmit() {
    setIsSaving(true)

    try {
      if (selectedMode === 'existing') {
        if (!selectedDevice) {
          throw new Error(t('gpodder_select_device'))
        }

        await persistCredentials(selectedDevice)
        return
      }

      const trimmedName = newDeviceName.trim()
      const normalizedDeviceName = normalizeDeviceId(trimmedName)

      if (!trimmedName || !normalizedDeviceName) {
        throw new Error(t('gpodder_device_name_required'))
      }

      await createOrUpdateDevice(verifiedServer, verifiedUser, verifiedPassword, normalizedDeviceName, trimmedName)
      await persistCredentials(normalizedDeviceName)
    } catch (error) {
      toastError((error as Error).message || t('login_failed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex h-full w-full gap-2 p-1">
      <img className="w-32 shrink-0 p-1" src={gpodderLogo} alt="Gpodder logo" />
      <form
        className="flex w-full flex-col items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault()

          if (credentialsVerified) {
            await handleDeviceSubmit()
            return
          }

          await verifyCredentials()
        }}
      >
        <div className="flex w-11/12 flex-col items-end gap-2">
          <input
            id="server"
            name="server"
            required
            type="url"
            onInput={checkURLScheme}
            className="bg-primary-8 w-full rounded-md px-2 py-1 focus:outline-none"
            placeholder={t('gpodder_server_url')}
            value={server}
            disabled={credentialsVerified || isVerifying || isSaving}
            onChange={(e) => setServer(e.currentTarget.value)}
          />
          <div className="flex w-3/4 gap-1.5">
            <input
              name="user"
              type="text"
              required
              className="bg-primary-8 w-full rounded-md px-2 py-1 focus:outline-none"
              placeholder={t('username')}
              value={user}
              disabled={credentialsVerified || isVerifying || isSaving}
              onChange={(e) => setUser(e.currentTarget.value)}
            />
            <input
              name="password"
              type="password"
              required
              className="bg-primary-8 w-full rounded-md px-2 py-1 focus:outline-none"
              placeholder={t('password')}
              value={password}
              disabled={credentialsVerified || isVerifying || isSaving}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
          </div>
          {!credentialsVerified && (
            <button className="filled-button p-1 px-4 uppercase" disabled={isVerifying || isSaving}>
              {isVerifying ? t('gpodder_verifying') : t('connect')}
            </button>
          )}
          {credentialsVerified && (
            <>
              <div className="w-3/4 self-center text-sm opacity-80">{t('gpodder_choose_device')}</div>
              {devices.length > 0 && (
                <label className="flex w-3/4 items-center gap-2">
                  <input
                    type="radio"
                    name="device-mode"
                    checked={selectedMode === 'existing'}
                    onChange={() => setSelectedMode('existing')}
                    disabled={isSaving}
                  />
                  <span>{t('gpodder_use_existing_device')}</span>
                </label>
              )}
              {devices.length > 0 && (
                <select
                  className="bg-primary-8 w-3/4 rounded-md px-2 py-1 focus:outline-none disabled:opacity-60"
                  value={selectedDevice}
                  disabled={selectedMode !== 'existing' || isSaving}
                  onChange={(e) => setSelectedDevice(e.currentTarget.value)}
                >
                  {devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.caption?.trim() ? `${device.caption} (${device.id})` : device.id}
                    </option>
                  ))}
                </select>
              )}
              <label className="flex w-3/4 items-center gap-2">
                <input
                  type="radio"
                  name="device-mode"
                  checked={selectedMode === 'new'}
                  onChange={() => setSelectedMode('new')}
                  disabled={isSaving}
                />
                <span>{t('gpodder_create_device')}</span>
              </label>
              <input
                name="device"
                className="bg-primary-8 w-3/4 rounded-md px-2 py-1 focus:outline-none disabled:opacity-60"
                placeholder={t('gpodder_new_device_name')}
                value={newDeviceName}
                disabled={selectedMode !== 'new' || isSaving}
                onChange={(e) => setNewDeviceName(e.currentTarget.value)}
              />
              <div className="flex w-3/4 justify-end gap-2">
                <button
                  type="button"
                  className="px-2 py-1 uppercase opacity-80"
                  disabled={isSaving}
                  onClick={() => {
                    setVerifiedServer('')
                    setVerifiedUser('')
                    setVerifiedPassword('')
                    setDevices([])
                    setSelectedDevice('')
                    setNewDeviceName('')
                    setSelectedMode('existing')
                  }}
                >
                  {t('gpodder_change_credentials')}
                </button>
                <button className="filled-button p-1 px-4 uppercase" disabled={isSaving}>
                  {isSaving ? t('gpodder_saving_device') : t('gpodder_finish_connect')}
                </button>
              </div>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
