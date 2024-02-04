/*
 *  utils.ts is a part of Moosync.
 *
 *  Copyright 2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import path from 'path'
import { app } from 'electron'

import { access, rename } from 'fs/promises'
import { Worker, spawn } from 'threads'
import { WorkerModule } from 'threads/dist/types/worker'
import { _windowHandler } from '../windowManager'
import { loadSelectivePreference } from './preferences'

export class DBWorkerWrapper {
  private worker: Unpromise<ReturnType<typeof spawn<WorkerModule<string>>>> | undefined

  private preWorkerQueue: { method: string; args: unknown; resolver: (arg: unknown) => void }[] = []

  constructor(dbPath?: string) {
    this.start(dbPath ?? path.join(app.getPath('appData'), app.getName(), 'databases', 'songs.db'))
  }

  private async executeAllPending() {
    for (const exec of this.preWorkerQueue) {
      const res = await this.worker?.execute(exec.method, exec.args)
      exec.resolver(res)
    }

    this.preWorkerQueue = []
  }

  public async start(dbPath: string) {
    this.worker = await spawn(new Worker(`${__dirname}/sqlite3.worker.js`))
    try {
      await this.worker.start(app.getPath('logs'), dbPath, loadSelectivePreference('thumbnailPath'))
      await this.executeAllPending()
    } catch (e) {
      await this.close()
      console.error(e)
      await this.recreateDatabase(dbPath)
      await _windowHandler.restartApp()
    }
  }

  public async close() {
    if (this.worker) await this.worker.close()
  }

  protected async execute(method: string, args: unknown[]) {
    if (!this.worker) {
      const promise = new Promise<unknown>((resolver) => {
        this.preWorkerQueue.push({ method, args, resolver })
      })
      return promise
    }
    return this.worker?.execute(method, args)
  }

  private async recreateDatabase(dbPath: string) {
    await access(dbPath)
    await rename(dbPath, path.join(path.dirname(dbPath), `${Date.now()}-songs.db.bak`))

    const wal = path.join(path.dirname(dbPath), 'songs.db-wal')
    const shm = path.join(path.dirname(dbPath), 'songs.db-shm')

    await rename(wal, path.join(path.dirname(dbPath), `${Date.now()}-songs.db-wal.bak`))
    await rename(shm, path.join(path.dirname(dbPath), `${Date.now()}-songs.db-shm.bak`))
  }
}
