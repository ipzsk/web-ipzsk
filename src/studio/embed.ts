// IPZSK Desktop shows the studio as two native views: `?pane=nav` over its own sidebar, the rest as the main pane.
// They are separate documents on one origin, kept in step over a BroadcastChannel.
import { useEffect, useRef } from 'react'
import type { StudioKind } from './SiteHeader'

/** The desktop studio views append this marker to their user agent. */
export const desktopEmbed = typeof navigator !== 'undefined' && navigator.userAgent.includes('IPZSK-Desktop')
export const embedPane: 'nav' | 'main' | null = !desktopEmbed ? null
  : new URLSearchParams(location.search).get('pane') === 'nav' ? 'nav' : 'main'

export type EmbedMessage =
  | { type: 'hello' } // nav → main: send me your state
  | { type: 'route'; to: string } // nav → main: navigate
  | { type: 'kind'; kind: StudioKind } // nav → main: switch 图片/视频/数字人
  | { type: 'recharge' } // nav → main: open the recharge dialog (the nav pane is too narrow for it)
  | { type: 'state'; path: string; kind: StudioKind } // main → nav: where the main pane is

const channel = embedPane && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ipzsk-studio-embed') : null

export const postEmbed = (message: EmbedMessage) => channel?.postMessage(message)

/** Subscribe to the other pane's messages; the latest handler is always used. */
export function useEmbedMessages(handler: (message: EmbedMessage) => void) {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    if (!channel) return
    const listener = (event: MessageEvent<EmbedMessage>) => latest.current(event.data)
    channel.addEventListener('message', listener)
    return () => channel.removeEventListener('message', listener)
  }, [])
}

if (embedPane) document.documentElement.dataset.embed = embedPane
