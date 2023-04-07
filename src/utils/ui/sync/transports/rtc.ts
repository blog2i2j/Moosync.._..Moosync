import { Socket } from 'socket.io-client'
import { v4 } from 'uuid'
import {
  GenericTransport,
  PartialSyncTransportRequest,
  SyncMessageData,
  SyncMessageEvents,
  SyncMessageResponse,
  SyncTransportRequest,
  SyncTransportResponse
} from './genericTransport'

const STUN = {
  urls: [
    'stun:stun.l.google.com:19302',
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
    'stun:stun3.l.google.com:19302',
    'stun:stun4.l.google.com:19302',
    'stun:stun.ekiga.net',
    'stun:stun.ideasip.com',
    'stun:stun.rixtelecom.se',
    'stun:stun.schlund.de',
    'stun:stun.stunprotocol.org:3478',
    'stun:stun.voiparound.com',
    'stun:stun.voipbuster.com',
    'stun:stun.voipstunt.com',
    'stun:stun.voxgratia.org'
  ]
}

const TURN = {
  urls: 'turn:retardnetwork.cf:7888',
  username: 'oveno',
  credential: '1234'
}

const finalPeerStates: RTCPeerConnectionState[] = ['closed', 'connected', 'disconnected', 'failed']

export class RTCPeerTransport extends GenericTransport {
  constructor(socket: Socket, peerId: string) {
    super(socket, peerId)
  }

  private peer!: RTCPeerConnection
  private textChannel!: RTCDataChannel

  private isNegotiating = false

  private async waitTillConnect() {
    if (!this.peer) {
      await this.peerPromise
    }

    if (!finalPeerStates.includes(this.peer.connectionState)) {
      await new Promise<void>((resolve, reject) => {
        const listener = () => {
          if (finalPeerStates.includes(this.peer.connectionState)) {
            this.peer.removeEventListener('connectionstatechange', listener)
            if (this.peer.connectionState === 'connected') resolve()
            else reject()
          }
        }

        this.peer.addEventListener('connectionstatechange', listener)
      })
    }

    if (!this.textChannel) {
      await new Promise<void>((resolve) => {
        const listener = () => {
          this.peer.removeEventListener('datachannel', listener)
          resolve()
        }

        this.peer.addEventListener('datachannel', listener)
      })
    }

    return new Promise<void>((resolve, reject) => {
      const successListener = () => {
        this.textChannel.removeEventListener('open', successListener)
        this.textChannel.removeEventListener('error', failedListener)
        resolve()
      }

      const failedListener = () => {
        this.textChannel.removeEventListener('open', successListener)
        this.textChannel.removeEventListener('error', failedListener)
        reject()
      }

      this.textChannel.addEventListener('open', successListener)
      this.textChannel.addEventListener('error', failedListener)
    })
  }

  async start() {
    this.addRemoteCandidate()
    this.onOffer()
    this.onAnswer()

    await this.waitTillConnect()
  }

  private makePeer(): RTCPeerConnection {
    // Creates new peer
    const peer = new RTCPeerConnection({ iceServers: [STUN, TURN] })

    this.onLocalCandidate(peer)
    return peer
  }

  private onOffer() {
    console.debug('listening to', `offer-${this.peerId}`)
    this.socket.on(`offer-${this.peerId}`, (id: string, description: RTCSessionDescription) => {
      console.debug('Got offer')
      this.setupWatcher(id, description)
    })
  }

  private listenSignalingState(peer: RTCPeerConnection): void {
    peer.onsignalingstatechange = (e) => {
      this.isNegotiating = (e.target as RTCPeerConnection).signalingState != 'stable'
    }
  }

  private makeDataChannel(peer: RTCPeerConnection) {
    this.textChannel = peer.createDataChannel('text-channel')
    this.listenMessages()
  }

  async onUserJoined() {
    const peer = this.makePeer()
    this.listenSignalingState(peer)
    this.needsNegotiation(peer)
    this.peer = peer

    this.makeDataChannel(peer)

    await this.waitTillConnect()
  }

  private makeOffer(peer: RTCPeerConnection) {
    // Send offer to signalling server
    peer
      .createOffer()
      .then((sdp) => peer.setLocalDescription(sdp))
      .then(() => console.debug('emitting', `offer-${this.socket.id}`))
      .then(() => this.socket?.emit(`offer-${this.socket.id}`, this.peerId, peer.localDescription))
  }

  private onAnswer() {
    console.debug('listening to', `answer-${this.peerId}`)
    this.socket.on(`answer-${this.peerId}`, (id: string, description: RTCSessionDescription) => {
      console.debug('got answer')
      if (this.isNegotiating) this.peer?.setRemoteDescription(description)
    })
  }

  private needsNegotiation(peer: RTCPeerConnection) {
    peer.onnegotiationneeded = () => {
      if (!this.isNegotiating) {
        this.isNegotiating = true
        this.makeOffer(peer)
      }
    }
  }

  private onDataChannel(peer: RTCPeerConnection) {
    peer.ondatachannel = (event) => {
      this.textChannel = event.channel
      this.listenMessages()
    }
  }

  private _peerResolve!: () => void
  private peerPromise = new Promise<void>((resolve) => (this._peerResolve = resolve))

  private setupWatcher(id: string, description: RTCSessionDescription) {
    let peer: RTCPeerConnection

    const existingPeer = this.peer
    if (existingPeer) peer = existingPeer
    else peer = this.makePeer()

    this.listenSignalingState(peer)
    this.onDataChannel(peer)

    peer
      .setRemoteDescription(description)
      .then(() => peer.createAnswer())
      .then((sdp) => peer.setLocalDescription(sdp))
      .then(() => console.debug('emitting', `answer-${this.socket.id}`))
      .then(() => this.socket?.emit(`answer-${this.socket.id}`, id, peer.localDescription))

    this.peer = peer
    this._peerResolve()
  }

  private addRemoteCandidate() {
    console.debug('listening to', `candidate-${this.peerId}`)
    this.socket.on(`candidate-${this.peerId}`, (id: string, candidate: RTCIceCandidate) => {
      console.debug('got candidate', candidate)
      this.peer.addIceCandidate(new RTCIceCandidate(candidate))
    })
  }

  private onLocalCandidate(peer: RTCPeerConnection) {
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        console.debug('emitting', `candidate-${this.socket.id}`)
        this.socket?.emit(`candidate-${this.socket.id}`, this.peerId, event.candidate)
      }
    }
  }

  private requestCallbacks: Partial<Record<string, (data: SyncMessageResponse<SyncMessageEvents>) => void>> = {}

  private getTypeAndCallback(
    data: SyncTransportRequest<SyncMessageEvents> | SyncTransportResponse<SyncMessageEvents>
  ): ['REQUEST' | 'RESPONSE', (data: unknown) => Promise<unknown>] {
    if (data.type === 'REQUEST')
      return ['RESPONSE', RTCPeerTransport.responseCallbacks[data.event] as (data: unknown) => Promise<unknown>]
    else return ['REQUEST', this.requestCallbacks[data.id] as (data: unknown) => Promise<unknown>]
  }

  private listenMessages() {
    this.textChannel.onmessage = async (ev: MessageEvent<string>) => {
      const data: SyncTransportRequest<SyncMessageEvents> | SyncTransportResponse<SyncMessageEvents> = JSON.parse(
        ev.data
      )

      const ret: Partial<SyncTransportRequest<SyncMessageEvents> | SyncTransportResponse<SyncMessageEvents>> = {
        event: data.event,
        id: data.id
      }

      const [type, callback] = this.getTypeAndCallback(data)
      if (callback) {
        ret.data = (await callback(data.data)) as SyncMessageData<SyncMessageEvents>
        ret.type = type
      }

      if (ret.type === 'RESPONSE') this.textChannel.send(JSON.stringify(ret))
    }
  }

  async send<T extends SyncMessageEvents>(data: PartialSyncTransportRequest<T>): Promise<SyncMessageResponse<T>> {
    const req: SyncTransportRequest<T> = { ...data, id: v4(), type: 'REQUEST' }

    let _resolve: (val: SyncMessageResponse<T>) => void
    const promise = new Promise<SyncMessageResponse<T>>((resolve) => (_resolve = resolve))

    this.requestCallbacks[req.id] = (d) => _resolve(d as SyncMessageResponse<T>)
    this.textChannel?.send(JSON.stringify(req))

    return promise
  }
}
