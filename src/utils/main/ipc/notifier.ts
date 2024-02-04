/*
 *  notifier.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { IpcEvents, NotifierEvents } from './constants'

import { watch } from 'fs/promises'
import { WindowHandler } from '../windowManager'

export class NotifierChannel implements IpcChannelInterface {
  name = IpcEvents.NOTIFIER

  private watchingFiles: { path: string; cancel: AbortController }[] = []

  handle(event: Electron.IpcMainEvent, request: IpcRequest): void {
    switch (request.type) {
      case NotifierEvents.WATCH_FILE_CHANGES:
        this.watchFileChanges(event, request as IpcRequest<NotifierRequests.FileChanges>)
        break
    }
  }

  private async watchFileChanges(event: Electron.IpcMainEvent, request: IpcRequest<NotifierRequests.FileChanges>) {
    if (request.params.path && request.params.watch) {
      const ac = new AbortController()
      const watcher = watch(request.params.path, { signal: ac.signal })
      this.watchingFiles.push({ path: request.params.path, cancel: ac })
      event.reply(request.responseChannel)

      try {
        for await (const _ of watcher) {
          if (request.params.mainWindow === 'both') {
            WindowHandler.getWindow(true)?.webContents.send(NotifierEvents.FILE_CHANGED, request.params.path)
            WindowHandler.getWindow(false)?.webContents.send(NotifierEvents.FILE_CHANGED, request.params.path)
          } else {
            WindowHandler.getWindow(request.params.mainWindow ?? false)?.webContents.send(
              NotifierEvents.FILE_CHANGED,
              request.params.path,
            )
          }
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        console.error(e)
      }
    }

    if (request.params.path && !request.params.watch) {
      const found = this.watchingFiles.findIndex((val) => val.path === request.params.path)
      if (found !== -1) {
        this.watchingFiles[found]?.cancel.abort()
        this.watchingFiles.splice(found, 1)
      }
      event.reply(request.responseChannel)
    }
  }
}
