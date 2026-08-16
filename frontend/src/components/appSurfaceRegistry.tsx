import type { ReactElement } from 'react'
import { Chats } from '../pages/Chats'
import { Widgets } from '../pages/Widgets'

// The compiled allow list of App pages.
//
// A manifest never names a component, an import or a path — it names a
// `(appKey, surfaceKey)` pair, and only a pair present HERE renders anything. That is
// what makes a page from a manifest impossible to turn into code execution: the
// manifest can ask for a page that does not exist, and nothing happens.

export interface SurfaceRoute {
  appKey: string
  surfaceKey: string
  // The URL uses dashes; the App key uses underscores.
  path: string
  element: () => ReactElement
}

export const APP_SURFACE_ROUTES: SurfaceRoute[] = [
  {
    appKey: 'web_chat',
    surfaceKey: 'widgets',
    path: '/apps/web-chat/widgets',
    element: () => <Widgets channel="web" current="/apps/web-chat/widgets" title="Chat Web · Widgets" />,
  },
  {
    appKey: 'web_chat',
    surfaceKey: 'conversations',
    path: '/apps/web-chat/conversations',
    element: () => <Chats channel="web" current="/apps/web-chat/conversations" title="Conversas Web" />,
  },
  {
    appKey: 'whatsapp',
    surfaceKey: 'channels',
    path: '/apps/whatsapp/channels',
    element: () => <Widgets channel="whatsapp" current="/apps/whatsapp/channels" title="WhatsApp · Números" />,
  },
  {
    appKey: 'whatsapp',
    surfaceKey: 'conversations',
    path: '/apps/whatsapp/conversations',
    element: () => <Chats channel="whatsapp" current="/apps/whatsapp/conversations" title="Conversas WhatsApp" />,
  },
]

export const surfaceRouteFor = (appKey: string, surfaceKey: string): SurfaceRoute | undefined =>
  APP_SURFACE_ROUTES.find((r) => r.appKey === appKey && r.surfaceKey === surfaceKey)
