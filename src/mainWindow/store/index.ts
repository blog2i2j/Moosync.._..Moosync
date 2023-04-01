/*
 *  index.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { extractVuexModule } from 'vuex-class-component'

import { NotifierStore } from './notifications'
import { PlayerStore } from './playerState'
import { PlaylistStore } from '@/mainWindow/store/playlists'
import { ProviderStore } from '@/mainWindow/store/providers'
import { ThemeStore } from './themes'
import Vue from 'vue'
import Vuex from 'vuex'
import { createPersist } from '@/utils/ui/store/persist'
import { getProxy } from './vuexProvider'
import { ProxyWatchers } from 'vuex-class-component/dist/interfaces'
import { PlayerRepositoryStore } from './playersRepo'

Vue.use(Vuex)

export const store = new Vuex.Store({
  modules: {
    ...extractVuexModule(PlayerStore),
    ...extractVuexModule(PlaylistStore),
    ...extractVuexModule(ProviderStore),
    ...extractVuexModule(NotifierStore),
    ...extractVuexModule(ThemeStore),
    ...extractVuexModule(PlayerRepositoryStore)
  },
  plugins: [createPersist()]
})

// Vetur for  some reason does not infer the type from context unless explicitly defined
export const vxm: {
  player: InstanceType<typeof PlayerStore> & ProxyWatchers
  playlist: InstanceType<typeof PlaylistStore> & ProxyWatchers
  providers: InstanceType<typeof ProviderStore> & ProxyWatchers
  notifier: InstanceType<typeof NotifierStore> & ProxyWatchers
  themes: InstanceType<typeof ThemeStore> & ProxyWatchers
  playerRepo: InstanceType<typeof PlayerRepositoryStore> & ProxyWatchers
} = {
  player: getProxy(store, PlayerStore),
  playlist: getProxy(store, PlaylistStore),
  providers: getProxy(store, ProviderStore),
  notifier: getProxy(store, NotifierStore),
  themes: getProxy(store, ThemeStore),
  playerRepo: getProxy(store, PlayerRepositoryStore)
}
