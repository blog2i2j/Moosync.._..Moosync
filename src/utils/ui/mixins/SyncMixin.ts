/*
 *  SyncMixin.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { Component } from 'vue-property-decorator'
import ImgLoader from '@/utils/ui/mixins/ImageLoader'
import ModelHelper from '@/utils/ui/mixins/ModelHelper'
import { SyncHolder } from '../sync/syncHandler'
import { bus } from '@/mainWindow/main'
import { mixins } from 'vue-class-component'
import { vxm } from '@/mainWindow/store'
import { PeerMode } from '@/mainWindow/store/playerState'

@Component
export default class SyncMixin extends mixins(ModelHelper, ImgLoader) {
  private isFetching = false
  private peerHolder: SyncHolder = new SyncHolder()
  private isRemoteStateChange = false
  private isRemoteTrackChange = false
  public setSongSrcCallback!: (src: string) => void
  public onSeekCallback!: (time: number) => void

  private _resolve!: () => void
  private _reject!: (r: string) => void
  private initialized = new Promise<void>(this.attachPromise.bind(this))

  private isReadyRequested = false

  private attachPromise(resolve: () => void, reject: (r: string) => void) {
    this._resolve = resolve
    this._reject = reject
  }

  created() {
    console.log('created sync mixin')
    this.peerHolder
      .initialize()
      .then(() => {
        this._ignoreRemoteChange = 0
        this.peerHolder.start()
        vxm.player.socketID = this.peerHolder.socketID
        console.log('initialized', vxm.player.socketID)
        this._resolve()
      })
      .catch((err) => {
        this._reject(err)
      })
  }

  get isWatching() {
    return vxm.player.syncMode == PeerMode.WATCHER
  }

  get isSyncing() {
    return vxm.player.syncMode != PeerMode.UNDEFINED
  }

  private isYoutube(song: Song): boolean {
    return song.type === 'YOUTUBE' || song.type === 'SPOTIFY'
  }

  private async setLocalCover(event: Song, from: string) {
    let cover: string | undefined
    const senderSocket = await vxm.player.socketIdForSong(event._id)
    if (senderSocket === this.peerHolder.socketID) {
      cover = (
        await window.SearchUtils.searchSongsByOptions({
          song: {
            _id: event._id
          }
        })
      )[0].song_coverPath_high
    } else {
      cover = await window.FileUtils.isImageExists(event._id)
    }

    if (cover) vxm.player.setCover('media://' + cover)
    else {
      vxm.player.setCover('')
      this.peerHolder.requestCover(from, event._id)
    }
  }

  private async checkLocalAudio(event: Song) {
    const senderSocket = await vxm.player.socketIdForSong(event._id)
    if (senderSocket != this.peerHolder.socketID) {
      const isAudioExists = await window.FileUtils.isAudioExists(event._id)
      if (isAudioExists) {
        if (this.isReadyRequested) this.peerHolder.emitReady()
        this.setSongSrcCallback('media://' + isAudioExists)
      }
    }
  }

  private async checkYoutubeAudio() {
    if (this.isReadyRequested) this.peerHolder.emitReady()
  }

  private async setYoutubeCover(event: Song) {
    if (event.song_coverPath_low?.startsWith('http') || event.song_coverPath_high?.startsWith('http'))
      vxm.player.setCover(event.song_coverPath_high ?? event.song_coverPath_low ?? '')
    else vxm.player.setCover('')
  }

  private async setRemoteTrackInfo(from: string, songIndex: number) {
    vxm.player.queueIndex = songIndex
    const song = vxm.player.queueTop

    console.debug('Got remote track info', song, songIndex, from, this.peerHolder.socketID)

    if (song) {
      vxm.player.playQueueSong(songIndex)

      if (this.isSyncing) {
        if (this.peerHolder.socketID !== from) {
          this.isRemoteTrackChange = true
          vxm.player.playerState = 'PAUSED'
        } else {
          this.peerHolder.requestReadyStatus()
          vxm.player.loading = true
        }

        if (this.isYoutube(song)) {
          await this.setYoutubeCover(song)
          await this.checkYoutubeAudio()
        } else {
          await this.setLocalCover(song, from)
          await this.checkLocalAudio(song)
        }
      }
    }
  }

  private setRemoteCover(event: Blob) {
    if (this.isSyncing && vxm.player.currentSong) {
      const reader = new FileReader()
      const songID = vxm.player.currentSong._id
      reader.onload = async () => {
        if (reader.readyState == 2) {
          const buffer = Buffer.from(reader.result as ArrayBuffer)
          const filePath = await window.FileUtils.saveImageToFile(songID, buffer)
          vxm.player.setCover('media://' + filePath)
        }
      }
      reader.readAsArrayBuffer(event)
    }
  }

  private async getLocalCover(songID: string) {
    const songs = await window.SearchUtils.searchSongsByOptions({
      song: {
        _id: songID
      }
    })

    if (songs.length > 0 && songs[0]) {
      const song = songs[0]
      if (song) {
        const cover = this.getValidImageHigh(song) ?? this.getValidImageLow(song)
        if (cover) {
          const resp = await fetch(this.getImgSrc(cover))
          const buf = await resp.arrayBuffer()
          return buf
        }
      }
    }
    return null
  }

  private saveRemoteStream(event: Blob) {
    const reader = new FileReader()
    reader.onload = async () => {
      if (reader.readyState == 2) {
        const buffer = Buffer.from(reader.result as ArrayBuffer)
        const filePath = await window.FileUtils.saveAudioToFile(vxm.player.currentFetchSong, buffer)
        this.isFetching = false
        if (vxm.player.currentSong?._id == vxm.player.currentFetchSong) {
          if (this.isReadyRequested) this.peerHolder.emitReady()
          if (this.setSongSrcCallback) this.setSongSrcCallback('media://' + filePath)
        }
      }
    }
    reader.readAsArrayBuffer(event)
  }

  private async onLocalSongRequested(songID: string) {
    const songs = await window.SearchUtils.searchSongsByOptions({
      song: {
        _id: songID
      }
    })

    if (songs.length > 0 && songs[0]) {
      const song = songs[0]
      if (song) {
        const resp = await fetch('media://' + song.path)
        const buf = await resp.arrayBuffer()
        return buf
      }
    }
    return null
  }

  private async handleRemotePlayerState(state: PlayerState) {
    console.debug('got state', vxm.player.playerState)
    if (vxm.player.playerState !== state) {
      this.isRemoteStateChange = true
      vxm.player.playerState = state
    }
  }

  private onRemoteSeek(time: number) {
    this.onSeekCallback(time)
  }

  private handleReadyEmitted() {
    this.isReadyRequested = false
  }

  private async handleReadyRequest() {
    this.isReadyRequested = true
    if (vxm.player.currentSong) {
      if (vxm.player.currentSong.type === 'LOCAL') {
        const isAudioExists = await window.FileUtils.isAudioExists(vxm.player.currentSong._id)
        if (!this.isFetching) {
          /*
           * If the room is already streaming and another user joins in, everyone's state will be set to LOADING.
           * The users who already were playing the song might not be fetching and should only check if the audio exists
           */
          if (isAudioExists) this.peerHolder.emitReady()
        } else {
          /*
           * If the user is fetching a song, check if it matches the current playing.
           * If it does, then let it fetch and emitReady will be handled by saveRemoteStream
           * Otherwise check if audio exists and emitReady if it does
           */
          if (vxm.player.currentFetchSong != vxm.player.currentSong._id) {
            if (isAudioExists) this.peerHolder.emitReady()
          }
        }
      } else {
        this.peerHolder.emitReady()
      }
    }
  }

  private syncListeners() {
    this.peerHolder.onRemoteTrackInfo = this.setRemoteTrackInfo.bind(this)
    this.peerHolder.onRemoteCover = this.setRemoteCover.bind(this)
    this.peerHolder.getLocalCover = this.getLocalCover.bind(this)
    this.peerHolder.onRemoteStream = this.saveRemoteStream.bind(this)
    this.peerHolder.getRequestedSong = this.playRequested.bind(this)
    this.peerHolder.getLocalSong = this.onLocalSongRequested.bind(this)
    this.peerHolder.fetchCurrentSong = () => vxm.player.queueIndex
    this.peerHolder.onPlayerStateChange = this.handleRemotePlayerState.bind(this)
    this.peerHolder.onQueueOrderChange = this.onRemoteQueueOrderChange.bind(this)
    this.peerHolder.onQueueDataChange = this.onRemoteQueueDataChange.bind(this)
    // TODO: Handle this event somewhere
    this.peerHolder.peerConnectionStateHandler = (id, state) => bus.$emit('onPeerConnectionStateChange', id, state)
    this.peerHolder.onSeek = this.onRemoteSeek.bind(this)
    this.peerHolder.onReadyRequested = this.handleReadyRequest.bind(this)
    this.peerHolder.onReadyEmitted = this.handleReadyEmitted.bind(this)
    this.peerHolder.onRepeatChange = this.handleRepeat.bind(this)
    this.peerHolder.onAllReady = () => this.handleAllReady.bind(this)

    vxm.player.$watch('queueIndex', this.triggerQueueChange.bind(this))
    vxm.player.$watch('queueOrder', this.triggerQueueChange.bind(this))
    vxm.player.$watch('repeat', this.triggerRepeatChange.bind(this))
  }

  private handleAllReady() {
    vxm.player.loading = false
  }

  private isRemoteRepeatChange = false

  private triggerRepeatChange(repeat: boolean) {
    if (!this.isRemoteRepeatChange) {
      this.peerHolder.emitRepeat(repeat)
    } else {
      this.isRemoteRepeatChange = false
    }
  }

  private handleRepeat(repeat: boolean) {
    this.isRemoteRepeatChange = true
    vxm.player.Repeat = repeat
  }

  private playRequested(songIndex: number) {
    const song = vxm.player.queueData[vxm.player.queueOrder[songIndex].songID]
    console.debug('Play requested for', song)
    if (song) {
      vxm.player.loadSong(song)
    }
  }

  private async fetchSong() {
    console.debug('fetching status', this.isFetching)
    if (!this.isFetching) {
      console.debug('fetching song')
      this.isFetching = true
      for (const fetch of vxm.player.queueOrder) {
        const song = vxm.player.queueData[fetch.songID]
        const senderSocket = await vxm.player.socketIdForSong(song._id)
        if (senderSocket && song?.type === 'LOCAL') {
          const isExists = await window.FileUtils.isAudioExists(song._id)
          if (!isExists) {
            console.log('requesting local song')

            vxm.player.setCurrentFetchSong(song._id)
            this.peerHolder.requestSong(senderSocket, song._id)
            return
          }
        }
      }
    }
  }

  private _ignoreRemoteChange = 0

  private triggerQueueChange(val?: number) {
    console.log('_ignoreRemoteChange', this._ignoreRemoteChange)
    if (this._ignoreRemoteChange === 0) {
      console.log('emitting remote change')
      this.peerHolder.emitQueueChange(vxm.player.queueOrder, vxm.player.queueData, vxm.player.queueIndex)
    } else {
      this._ignoreRemoteChange -= 1
      console.log('_ignoreRemoteChange decremented', this._ignoreRemoteChange, typeof val)
    }
  }

  private onRemoteQueueOrderChange(order: QueueOrder, index: number) {
    console.log('_ignoreRemoteChange incremented', this._ignoreRemoteChange, order, index)

    this._ignoreRemoteChange += vxm.player.queueIndex === index ? 1 : 2

    vxm.player.setQueueOrder(order)
    vxm.player.setSongIndex({ oldIndex: vxm.player.queueIndex, newIndex: index, ignoreMove: false })

    this.fetchSong()
  }

  private onRemoteQueueDataChange(data: QueueData<Song>) {
    for (const d of Object.values(data)) {
      vxm.player.setSocketIdForSong({ songId: d._id, socketId: (d as RemoteSong).senderSocket })
    }
    vxm.player.setQueueData(data)
  }

  protected handleBroadcasterAudioLoad(): boolean {
    if (this.isSyncing) {
      if (this.isRemoteTrackChange) {
        this.isRemoteTrackChange = false
        return true
      }

      vxm.player.playerState = 'PAUSED'
      vxm.player.setCover('')
      this.peerHolder.playSong(vxm.player.queueIndex)

      return true
    }
    return false
  }

  private initializeRTC(mode: PeerMode) {
    this.peerHolder.peerMode = mode
    vxm.player.setMode(mode)

    this.peerHolder.onJoinedRoom = (id: string, isCreator: boolean) => {
      this.initialized
        .then(() => {
          this.syncListeners()

          vxm.player.setRoom(id)

          if (isCreator) {
            this.triggerQueueChange()
          }
        })
        .catch((err) => console.error(err))
    }
  }

  protected joinRoom(id: string) {
    console.debug('joining room', id)
    this.initializeRTC(PeerMode.WATCHER)
    this.peerHolder.joinRoom(id)
  }

  protected createRoom() {
    this.initializeRTC(PeerMode.BROADCASTER)
    this.peerHolder.createRoom()
  }

  protected remoteSeek(time: number) {
    this.peerHolder.emitSeek(time)
  }

  protected emitPlayerState(newState: PlayerState) {
    console.log('emitting player state')
    if (this.isSyncing && !this.isRemoteStateChange) {
      this.peerHolder.emitPlayerState(newState)
    }
    this.isRemoteStateChange = false
  }
}
