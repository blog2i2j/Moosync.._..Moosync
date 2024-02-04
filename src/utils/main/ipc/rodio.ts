/*
 *  mpris.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { IpcEvents, RodioEvents } from './constants'

import { isEmpty } from '@/utils/common'
import { RodioBackend } from 'rodio-audio-backend'
import { WindowHandler } from '../windowManager'

export class RodioChannel implements IpcChannelInterface {
  name = IpcEvents.RODIO

  isStarted = false
  private rodioInstance: RodioBackend | undefined

  handle(event: Electron.IpcMainEvent, request: IpcRequest): void {
    switch (request.type) {
      case RodioEvents.INITIALIZE:
        this.initialize(event, request)
        break
      case RodioEvents.SET_SRC:
        this.setSrc(event, request as IpcRequest<RodioRequests.SetSrc>)
        break
      case RodioEvents.PLAY:
        this.play(event, request)
        break
      case RodioEvents.PAUSE:
        this.pause(event, request)
        break
      case RodioEvents.STOP:
        this.stop(event, request)
        break
      case RodioEvents.SEEK:
        this.seek(event, request as IpcRequest<RodioRequests.Seek>)
        break
      case RodioEvents.SET_VOLUME:
        this.setVolume(event, request as IpcRequest<RodioRequests.Volume>)
        break
    }
  }

  private async initialize(event: Electron.IpcMainEvent, request: IpcRequest) {
    console.debug('Initializing Rodio backend')

    if (this.rodioInstance) {
      await this.rodioInstance.stop()
    }

    this.rodioInstance = new RodioBackend()
    this.registerListeners()

    event.reply(request.responseChannel)
  }

  private async setSrc(event: Electron.IpcMainEvent, request: IpcRequest<RodioRequests.SetSrc>) {
    if (request.params.path) {
      try {
        await this.rodioInstance?.setSrc(request.params.path)
      } catch (e) {
        this.emitError(e)
      }
    }

    event.reply(request.responseChannel)
  }

  private async play(event: Electron.IpcMainEvent, request: IpcRequest) {
    try {
      await this.rodioInstance?.play()
    } catch (e) {
      this.emitError(e)
    }
    event.reply(request.responseChannel)
  }

  private async pause(event: Electron.IpcMainEvent, request: IpcRequest) {
    try {
      await this.rodioInstance?.pause()
    } catch (e) {
      this.emitError(e)
    }
    event.reply(request.responseChannel)
  }

  public async stop(event?: Electron.IpcMainEvent, request?: IpcRequest) {
    try {
      await this.rodioInstance?.stop()
    } catch (e) {
      this.emitError(e)
    }
    event?.reply(request?.responseChannel ?? '')
  }

  private async setVolume(event: Electron.IpcMainEvent, request: IpcRequest<RodioRequests.Volume>) {
    if (!isEmpty(request.params.volume)) {
      try {
        await this.rodioInstance?.setVolume(request.params.volume / 100)
      } catch (e) {
        this.emitError(e)
      }
    }

    event.reply(request.responseChannel)
  }

  private async seek(event: Electron.IpcMainEvent, request: IpcRequest<RodioRequests.Seek>) {
    if (request.params.pos) {
      try {
        await this.rodioInstance?.seek(Number(request.params.pos.toFixed(0)))
      } catch (e) {
        this.emitError(e)
      }
    }

    event.reply(request.responseChannel)
  }

  private emitError(e: unknown) {
    WindowHandler.getWindow(true)?.webContents.send(IpcEvents.RODIO, RodioEvents.ON_ERROR, e)
  }

  private registerListeners() {
    this.rodioInstance?.on('play', () => {
      WindowHandler.getWindow(true)?.webContents.send(IpcEvents.RODIO, RodioEvents.ON_PLAY)
    })

    this.rodioInstance?.on('pause', () => {
      WindowHandler.getWindow(true)?.webContents.send(IpcEvents.RODIO, RodioEvents.ON_PAUSE)
    })

    this.rodioInstance?.on('stop', () => {
      WindowHandler.getWindow(true)?.webContents.send(IpcEvents.RODIO, RodioEvents.ON_STOP)
    })

    this.rodioInstance?.on('loaded', () => {
      WindowHandler.getWindow(true)?.webContents.send(IpcEvents.RODIO, RodioEvents.ON_LOADED)
    })

    this.rodioInstance?.on('ended', () => {
      WindowHandler.getWindow(true)?.webContents.send(IpcEvents.RODIO, RodioEvents.ON_ENDED)
    })

    this.rodioInstance?.on('timeUpdate', (val) => {
      WindowHandler.getWindow(true)?.webContents.send(IpcEvents.RODIO, RodioEvents.ON_TIME_UPDATE, val / 1000)
    })
  }
}
