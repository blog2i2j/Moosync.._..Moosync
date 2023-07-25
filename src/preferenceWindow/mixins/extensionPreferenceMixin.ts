/*
 *  extensionPreferenceMixin.ts is a part of Moosync.
 *
 *  Copyright 2021-2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
 *  Licensed under the GNU General Public License.
 *
 *  See LICENSE in the project root for license information.
 */

import { Component, Prop, Vue } from 'vue-facing-decorator'

import { v1 } from 'uuid'
import { getCurrentInstance, toRaw } from 'vue'

@Component
export class ExtensionPreferenceMixin<T> extends Vue {
  @Prop({ default: '' })
  public defaultValue!: T

  public prefKey?: string

  @Prop({ default: false })
  public isExtension!: boolean

  @Prop({ default: v1() })
  public packageName!: string

  @Prop({ default: () => null })
  private onValueFetch!: (val: unknown) => void

  @Prop({ default: () => null })
  private onValueChange!: (val: unknown) => void

  @Prop({ default: 'text' })
  type!: string

  protected shouldMergeDefaultValues = true

  public value: T | null = null

  public loading = false

  protected postFetch: (() => void) | undefined

  created() {
    this.prefKey = getCurrentInstance()?.vnode.key?.toString()
  }

  mounted() {
    this.fetch()
    this.registerPreferenceListener()
  }

  private isValueEmpty(value: unknown) {
    if (typeof value === 'undefined') return true

    if (typeof value === 'object') {
      if (value === null) return true
      if (Array.isArray(value)) return value.length === 0
      else return Object.keys(value).length === 0
    }

    return false
  }

  private fetch() {
    if (this.prefKey) {
      this.loading = true
      ;(this.type === 'password'
        ? window.Store.getSecure(toRaw(this.prefKey))
        : window.PreferenceUtils.loadSelective<T>(toRaw(this.prefKey), toRaw(this.isExtension))
      )
        .then((val) => {
          this.value = (this.isValueEmpty(val) ? this.defaultValue : val) as T
        })
        .then(() => {
          this.loading = false
        })
        .then(() => this.postFetch?.())
        .then(() => this.onValueFetch?.(this.value))
    }
  }

  private registerPreferenceListener() {
    if (this.prefKey) {
      window.PreferenceUtils.listenPreferenceChanged(toRaw(this.prefKey), false, (key) => {
        if (typeof key === 'string') {
          if (this.prefKey === key) {
            this.fetch()
          }
        }
      })
    }
  }

  public onInputChange() {
    if (this.prefKey) {
      if (this.type === 'password') {
        window.Store.setSecure(toRaw(this.prefKey), toRaw(this.value as string) ?? '')
      } else {
        window.PreferenceUtils.saveSelective(toRaw(this.prefKey), toRaw(this.value), toRaw(this.isExtension))
      }

      if (this.isExtension)
        window.ExtensionUtils.sendEvent({
          data: [{ key: this.prefKey.replace(`${this.packageName}.`, ''), value: this.value }],
          type: 'preferenceChanged',
          packageName: this.packageName,
        })
      else window.PreferenceUtils.notifyPreferenceChanged(toRaw(this.prefKey), toRaw(this.value))

      this.onValueChange?.(this.value)
    }
  }
}
