import { Socket } from 'socket.io-client'

export enum SyncMessageEvents {
  REQUEST_QUEUE
}

export type SyncMessageData<T extends SyncMessageEvents> = T extends SyncMessageEvents.REQUEST_QUEUE
  ? undefined
  : undefined

export type SyncMessageResponse<T extends SyncMessageEvents> = T extends SyncMessageEvents.REQUEST_QUEUE
  ? string
  : undefined

export interface SyncTransportRequest<T extends SyncMessageEvents> {
  id: string
  event: T
  data: SyncMessageData<T>
  type: 'REQUEST'
}

export interface SyncTransportResponse<T extends SyncMessageEvents> {
  id: string
  event: T
  data: SyncMessageResponse<T>
  type: 'RESPONSE'
}

export interface PartialSyncTransportRequest<T extends SyncMessageEvents> {
  event: T
  data: SyncMessageData<T>
}

export abstract class GenericTransport {
  constructor(protected socket: Socket, protected peerId: string) {}

  static init<T extends GenericTransport>(
    this: new (socket: Socket, peerId: string) => T,
    socket: Socket,
    peerId: string
  ) {
    return new this(socket, peerId)
  }

  abstract start(): Promise<void>
  abstract onUserJoined(): Promise<void>
  abstract send<T extends SyncMessageEvents>(data: PartialSyncTransportRequest<T>): Promise<SyncMessageResponse<T>>

  protected static responseCallbacks: Partial<
    Record<
      SyncMessageEvents,
      (data: SyncMessageData<SyncMessageEvents>) => Promise<SyncMessageResponse<SyncMessageEvents>>
    >
  > = {}

  static respond<T extends SyncMessageEvents>(
    event: T,
    receiveCallback: (data: SyncMessageData<T>) => Promise<SyncMessageResponse<T>>
  ): void {
    this.responseCallbacks[event] = receiveCallback
  }
}
