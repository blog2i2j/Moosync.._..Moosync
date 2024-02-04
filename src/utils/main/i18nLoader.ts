import { messages } from '../ui/i18n'
import { loadSelectivePreference } from './db/preferences'

export function $t(key: string): string {
  const langs = loadSelectivePreference<Checkbox[]>('system_language')
  const active = (langs ?? []).find((val) => val.enabled)
  const currentLocale = active?.key
  const localeMessages = messages[currentLocale as keyof typeof messages]
  return (
    key.split('.').reduce((obj, key) => {
      return obj?.[key]
      // rome-ignore lint/suspicious/noExplicitAny: <explanation>
    }, localeMessages as any) ?? key
  )
}
