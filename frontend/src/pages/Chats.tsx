import { AppLayout } from '../components/AppLayout'
import { ConversationsPanel } from '../components/ConversationsPanel'

// Also the page behind the two "Conversas" App surfaces. When one of them opens it,
// `channel` scopes both the title and the query.
export function Chats({ channel, current = '/chats', title = 'Chats' }: { channel?: 'web' | 'whatsapp'; current?: string; title?: string } = {}) {
  return (
    <AppLayout current={current} title={title}>
      <ConversationsPanel channel={channel} />
    </AppLayout>
  )
}
