/*
 *  spotifyPlayer.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { IpcEvents, SpotifyEvents } from './constants'
import { fork, ChildProcess } from 'child_process'
import { ConstructorConfig, PlayerEvent } from 'librespot-node'
import { v1 } from 'uuid'
import EventEmitter from 'events'
import { PlayerEventTypes } from 'librespot-node'
import path from 'path'
import { app } from 'electron'

const defaultLogPath = path.join(app.getPath('logs'))

function spawn_child(forceKill = false) {
  return function (target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: unknown[]) {
      if (
        this instanceof SpotifyPlayerChannel &&
        (!this.playerProcess || this.playerProcess.killed || !this.playerProcess.connected || forceKill)
      ) {
        if (forceKill) {
          this.config = undefined
        }
        await this.spawnProcess()
      }

      return originalMethod.bind(this)(...args)
    }
  }
}

export class SpotifyPlayerChannel implements IpcChannelInterface {
  name = IpcEvents.SPOTIFY
  public playerProcess?: ChildProcess

  public config: ConstructorConfig | undefined
  public isConnected = false

  private eventEmitter = new EventEmitter()

  private listeners: Record<string, (e: PlayerEvent) => void> = {}

  handle(event: Electron.IpcMainEvent, request: IpcRequest<never>): void {
    switch (request.type) {
      case SpotifyEvents.CONNECT:
        this.connect(event, request)
        break
      case SpotifyEvents.LISTEN_EVENT:
        this.on(event, request)
        break
      case SpotifyEvents.REMOVE_EVENT:
        this.off(event, request)
        break
      case SpotifyEvents.COMMAND:
        this.command(event, request)
        break
      case SpotifyEvents.CLOSE:
        this.closePlayer(event, request)
        break
      case SpotifyEvents.GET_TOKEN:
        this.getToken(event, request)
        break
    }
  }

  private async sendAsync<T extends SpotifyRequests.SpotifyCommands>(
    message: SpotifyMessage
  ): Promise<SpotifyRequests.ReturnType<T> | Error | undefined> {
    if (this.playerProcess && !this.playerProcess.killed && this.playerProcess.connected) {
      // Don't reject error instead resolve it. Makes it easier to pass it to renderer
      let resolveTimeout: ReturnType<typeof setTimeout>
      return new Promise<SpotifyRequests.ReturnType<T> | Error>((resolve) => {
        const id = v1()
        const listener = (message: PlayerChannelMessage) => {
          if (message.channel === id) {
            console.debug('Got reply from librespot', message)
            this.playerProcess?.off('message', listener)
            resolveTimeout && clearTimeout(resolveTimeout)

            if (message.error) {
              resolve(new Error(message.error))
              return
            }
            resolve(message.data as SpotifyRequests.ReturnType<T>)
          }
        }

        // Automatically resolve if no reply from child process in 5 secs
        resolveTimeout = setTimeout(() => {
          this.playerProcess?.off('message', listener)

          // TODO: Handle this better
          if (message.args['auth']['password']) message.args['auth']['password'] = '***'
          console.error('Failed to resolve message for message', message)
          resolve(new Error('Failed to resolve message'))
        }, 5000)

        this.playerProcess?.on('message', listener)

        try {
          const logObject = { data: message, channel: id }
          if (logObject.data.args['auth']['password']) logObject.data.args['auth']['password'] = '***'

          console.debug('sending message to spotify process', { data: message, channel: id })
          this.playerProcess?.send({ data: message, channel: id })
        } catch (e) {
          console.error('Failed to send message to librespot process', e)
          resolve(new Error('Failed to send message to librespot process'))
          this.playerProcess?.kill()
        }
      })
    }

    return undefined
  }

  public closePlayer(event?: Electron.IpcMainEvent, request?: IpcRequest, keepListeners = false) {
    if (this.playerProcess) {
      this.isConnected = false
      this.playerProcess.removeAllListeners()
      this.playerProcess.kill()

      if (!keepListeners) {
        this.eventEmitter.removeAllListeners()
        this.listeners = {}
      }

      this.playerProcess = undefined
    }

    event?.reply(request?.responseChannel)
  }

  private isEvent<T extends PlayerEventTypes>(val: unknown): val is PlayerEvent<T> {
    return !!(val as PlayerEvent).event
  }

  public async spawnProcess(retries = 0) {
    if (retries > 2) {
      throw new Error('Failed to spawn process. Retries: ' + retries)
    }

    console.debug('Spawning librespot process. Retry:', retries)

    this.closePlayer(undefined, undefined, true)
    this.playerProcess = fork(__dirname + '/spotify.js', ['logPath', defaultLogPath])
    this.playerProcess.stdout?.on('data', (d) => console.log('spotify player', d.toString()))
    this.playerProcess.stderr?.on('data', (d) => console.log('spotify player err:', d.toString()))

    await new Promise<void>((r) => {
      this.playerProcess?.once('spawn', () => r())
    })

    this.playerProcess.on('message', (message) => {
      if (this.isEvent(message)) {
        this.eventEmitter.emit(message.event, message)
      }
    })

    this.playerProcess.once('exit', () => {
      console.warn('Librespot process exited, respawning')
      this.spawnProcess(retries + 1)
    })
    this.playerProcess.once('close', () => {
      console.warn('Librespot process closed, respawning')
      this.spawnProcess(retries + 1)
    })
    this.playerProcess.once('error', (err) => {
      console.warn('Librespot process errored, respawning', err)
      this.spawnProcess(retries + 1)
    })

    if (this.config) {
      await this.sendAsync({ type: 'CONNECT', args: this.config })
    }
  }

  @spawn_child()
  public async command<T extends SpotifyRequests.SpotifyCommands>(
    event: Electron.IpcMainEvent | undefined,
    request: IpcRequest<SpotifyRequests.Command<T>>
  ) {
    const resp = await this.sendAsync<T>({ type: 'COMMAND', args: request.params })
    event?.reply(request.responseChannel, resp)
    return resp
  }

  @spawn_child()
  private on(event: Electron.IpcMainEvent, request: IpcRequest<SpotifyRequests.EventListener>) {
    const listener = (e: PlayerEvent) => event.sender.send(request.responseChannel ?? '', e)
    this.eventEmitter.on(request.params.event, listener)
    this.listeners[request.params.event] = listener
  }

  private off(event: Electron.IpcMainEvent, request: IpcRequest<SpotifyRequests.EventListener>) {
    const listener = this.listeners[request.params.event]
    if (listener) {
      delete this.listeners[request.params.event]
      this.eventEmitter.off(request.params.event, listener)
    }
    event.reply(request.responseChannel)
  }

  @spawn_child(true)
  private async connect(event: Electron.IpcMainEvent, request: IpcRequest<SpotifyRequests.Config>) {
    request.params.cache = {
      credentials_location: path.join(app.getPath('sessionData'), app.getName()),
      audio_location: path.join(app.getPath('sessionData'), app.getName(), 'audio_cache')
    }

    const ret = await this.sendAsync({ type: 'CONNECT', args: request.params })
    if (!(ret instanceof Error)) {
      this.config = request.params
      this.isConnected = true
    } else {
      this.isConnected = false
    }

    event.reply(request.responseChannel, ret)
  }

  @spawn_child()
  private async getToken(event: Electron.IpcMainEvent, request: IpcRequest<SpotifyRequests.Token>) {
    const token = await this.sendAsync({ type: 'TOKEN', args: request.params.scopes })
    event.reply(request.responseChannel, token)
  }
}
