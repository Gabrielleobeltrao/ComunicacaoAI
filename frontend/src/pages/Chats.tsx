import { AppLayout } from '../components/AppLayout'
import { ConversationsPanel } from '../components/ConversationsPanel'

export function Chats() {
  return (
    <AppLayout current="/chats" title="Chats">
      <ConversationsPanel />
    </AppLayout>
  )
}
