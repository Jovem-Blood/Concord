import type { CaptureProfile, CaptureSourceDTO } from '../../../shared/capture'
import { AppError } from '../../../shared/errors'

export type CaptureEnvironment = 'electron' | 'web'

export type CaptureCapabilities = {
  environment: CaptureEnvironment
  usesNativePicker: boolean
  systemAudio: 'supported' | 'optional'
}

export type CaptureRequest = {
  source?: CaptureSourceDTO
  includeSystemAudio: boolean
  profile: CaptureProfile
}

export interface CaptureProvider {
  readonly capabilities: CaptureCapabilities
  listSources(): Promise<CaptureSourceDTO[]>
  capture(request: CaptureRequest): Promise<MediaStream>
  cancel(): Promise<void>
}

type ExtendedDisplayMediaOptions = DisplayMediaStreamOptions & {
  monitorTypeSurfaces?: 'include' | 'exclude'
  selfBrowserSurface?: 'include' | 'exclude'
  surfaceSwitching?: 'include' | 'exclude'
  systemAudio?: 'include' | 'exclude'
}

function videoConstraints(profile: CaptureProfile): MediaTrackConstraints {
  return {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: profile === 'smooth' ? 30 : 15 },
  }
}

function requireDisplayCapture(): typeof navigator.mediaDevices.getDisplayMedia {
  const getDisplayMedia = navigator.mediaDevices?.getDisplayMedia
  if (!getDisplayMedia) {
    throw new AppError(
      'CAPTURE_UNAVAILABLE',
      'Este navegador não oferece compartilhamento de tela. Use uma versão recente em HTTPS.',
    )
  }
  return getDisplayMedia.bind(navigator.mediaDevices)
}

class BrowserCaptureProvider implements CaptureProvider {
  readonly capabilities: CaptureCapabilities = {
    environment: 'web',
    usesNativePicker: true,
    systemAudio: 'optional',
  }

  async listSources(): Promise<CaptureSourceDTO[]> {
    return []
  }

  async capture(request: CaptureRequest): Promise<MediaStream> {
    const getDisplayMedia = requireDisplayCapture()
    const options: ExtendedDisplayMediaOptions = {
      video: videoConstraints(request.profile),
      audio: request.includeSystemAudio,
      monitorTypeSurfaces: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
      systemAudio: request.includeSystemAudio ? 'include' : 'exclude',
    }
    return getDisplayMedia(options)
  }

  async cancel(): Promise<void> {}
}

class ElectronCaptureProvider implements CaptureProvider {
  readonly capabilities: CaptureCapabilities = {
    environment: 'electron',
    usesNativePicker: false,
    systemAudio: 'supported',
  }

  async listSources(): Promise<CaptureSourceDTO[]> {
    return this.requireAPI().listSources()
  }

  async capture(request: CaptureRequest): Promise<MediaStream> {
    if (!request.source) {
      throw new AppError('CAPTURE_SOURCE_GONE', 'Escolha uma tela ou janela para compartilhar.')
    }

    const api = this.requireAPI()
    await api.selectSource({
      sourceId: request.source.id,
      includeSystemAudio: request.includeSystemAudio,
    })

    try {
      return await requireDisplayCapture()({
        video: videoConstraints(request.profile),
        audio: request.includeSystemAudio,
      })
    } catch (error) {
      await api.cancelSelection()
      throw error
    }
  }

  async cancel(): Promise<void> {
    await this.requireAPI().cancelSelection()
  }

  private requireAPI() {
    if (!window.captureAPI) {
      throw new AppError('CAPTURE_UNAVAILABLE', 'A integração de captura do aplicativo não está disponível.')
    }
    return window.captureAPI
  }
}

export function createCaptureProvider(): CaptureProvider {
  return window.captureAPI ? new ElectronCaptureProvider() : new BrowserCaptureProvider()
}

export const captureProvider = createCaptureProvider()
