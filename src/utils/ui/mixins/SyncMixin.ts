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
import { InitialConnectionHandler } from '../sync/initialConnection'
import { mixins } from 'vue-class-component'
import { vxm } from '@/mainWindow/store'

@Component
export default class SyncMixin extends mixins(ModelHelper, ImgLoader) {
  private peerHolder: InitialConnectionHandler = new InitialConnectionHandler()

  created() {
    this.peerHolder.initialize()
  }

  protected async joinRoom(id: string) {
    const resp = await this.peerHolder.joinRoom(id)
    vxm.player.setRoom(resp)
    console.debug('joined room', resp)
  }

  protected async createRoom() {
    const resp = await this.peerHolder.joinRoom()
    vxm.player.setRoom(resp)
    console.debug('created room', resp)
  }
}
