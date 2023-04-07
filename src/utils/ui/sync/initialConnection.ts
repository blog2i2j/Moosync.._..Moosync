/*
 *  syncHandler.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { ManagerOptions, Socket, io } from 'socket.io-client'
import { GenericTransport, SyncMessageEvents } from './transports/genericTransport'
import { RTCPeerTransport } from './transports/rtc'

const connectionOptions: Partial<ManagerOptions> = {
  forceNew: true,
  reconnection: true,
  reconnectionAttempts: 2,
  timeout: 10000,
  transports: ['websocket']
}

type TransportsArray = (typeof GenericTransport & (new (socket: Socket, peerId: string) => GenericTransport))[]

export class InitialConnectionHandler {
  private socketConnection!: Socket
  public socketID = ''
  private initialized = false

  private transports: TransportsArray = [RTCPeerTransport]

  private connections: Record<string, GenericTransport> = {}

  constructor() {
    const handler = {
      get: function (obj: InitialConnectionHandler, methodName: keyof InitialConnectionHandler) {
        return typeof obj[methodName] !== 'function'
          ? obj[methodName]
          : function (...args: unknown[]) {
              if (obj.isInitialized(methodName)) {
                return (obj[methodName] as (...args: unknown[]) => void)(...args)
              }
            }
      }
    }

    return new Proxy(this, handler)
  }

  private isInitialized(methodName: string) {
    if (methodName !== 'isInitialized' && methodName !== 'initialize') {
      if (!this.socketConnection) {
        throw new Error('Handler not initialized, call initialize()')
      }

      return this.initialized
    }
    return true
  }

  public async initialize(url?: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      this.socketConnection = io(url ? url : 'http://localhost:4000', connectionOptions)
      this.socketConnection.on('connect', () => {
        if (this.socketConnection?.id) {
          this.socketID = this.socketConnection.id
          this.initialized = true
          resolve(true)
        }
      })

      let tries = 0

      this.socketConnection?.on('connect_error', (error: Error) => {
        tries++
        if (tries === 3) reject(error)
      })

      this.setupResponses()
      this.onUserJoined()
    })
  }

  private getDesiredTransport() {
    return this.transports[0]
  }

  private onUserJoined() {
    console.log('listening user joined')
    this.socketConnection?.on('userJoined', async (id: string) => {
      const transport = this.getDesiredTransport().init(this.socketConnection, id)
      await transport.start()

      this.connections[id] = transport

      console.debug('got user joined', id)
    })
  }

  private async connectToAllUsers(roomId: string) {
    const users = await sendSocketMessage<string[]>(this.socketConnection, 'getAllMembers', roomId)

    // Get members other than self
    for (const id of users.filter((val) => val !== this.socketID)) {
      const transport = this.getDesiredTransport().init(this.socketConnection, id)

      await Promise.all([transport.start(), transport.onUserJoined()])

      this.connections[id] = transport

      console.debug('starting connection to', id)
    }
  }

  async joinRoom(id?: string) {
    const method = id ? 'joinRoom' : 'createRoom'
    const resp = await sendSocketMessage<string>(this.socketConnection, method, id)

    if (method === 'joinRoom' && id) await this.connectToAllUsers(resp)

    return resp
  }

  private setupResponses() {
    for (const t of this.transports) {
      t.respond(SyncMessageEvents.REQUEST_QUEUE, async () => {
        return 'hello'
      })
    }
  }
}

function sendSocketMessage<T>(socket: Socket, event: string, ...message: unknown[]): Promise<T> {
  const response = new Promise<T>((resolve) => {
    socket.on(`${event}-ack`, (args: T) => resolve(args))
  })

  socket.emit(event, ...message)

  return response
}
