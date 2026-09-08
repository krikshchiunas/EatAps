// Вкладка «Лента» — корневой раздел приложения.
//
// Раньше на её месте в нижней навигации была зелёная кнопка «＋», которая
// открывала лист добавления приёма пищи. Это дублировало то, что уже есть на
// экране дня: там кнопка «＋ Добавить продукт» стоит у каждого приёма и знает,
// в какой именно приём добавляет. Центральная кнопка угадывала приём по
// времени суток и потому регулярно угадывала неправильно.
//
// Лента живёт здесь, а не внутри экрана «Общение», чтобы не существовать в
// двух местах одновременно.
import { useState } from 'react'
import { useStore } from '../store.jsx'
import { openDirect } from '../lib/messaging.js'
import FeedScreen from './FeedScreen.jsx'
import PublicProfile from './PublicProfile.jsx'
import ChatScreen from './messaging/ChatScreen.jsx'

export default function FeedTab({ onChatClosed }) {
  const { supabaseEnabled, user } = useStore()
  const [profileUser, setProfileUser] = useState(null)
  const [chat, setChat] = useState(null)

  // Из ленты можно написать автору — и диалог заводится тем же способом, что
  // и везде: сервер находит или создаёт его по собеседнику. Второй путь к
  // созданию переписки завёл бы вторую трактовку «когда диалог существует».
  const openChat = async (peer) => {
    setProfileUser(null)
    const res = await openDirect(peer.id)
    if (res?.error) return
    setChat({
      id: res.ok,
      kind: 'direct',
      title: peer.name || peer.display_name || peer.username || 'Диалог',
      avatarUrl: peer.avatar || peer.avatar_url || null,
      peerId: peer.id,
      state: 'accepted',
    })
  }

  if (!supabaseEnabled || !user) {
    return (
      <div className="screen">
        <h1 className="h1" style={{ margin: '4px 0 20px' }}>Лента</h1>
        <div className="card">
          <p className="muted" style={{ fontSize: 15 }}>
            Войдите в аккаунт (вкладка «Профиль»), чтобы видеть ленту.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <h1 className="h1" style={{ margin: '4px 0 16px' }}>Лента</h1>

      <FeedScreen onOpenProfile={setProfileUser} />

      {profileUser && (
        <PublicProfile
          userId={profileUser}
          onClose={() => setProfileUser(null)}
          onOpenProfile={setProfileUser}
          onOpenChat={openChat}
        />
      )}

      {chat && (
        <ChatScreen
          conversation={chat}
          onClose={() => { setChat(null); onChatClosed?.() }}
          onOpenProfile={setProfileUser}
          onChanged={onChatClosed}
        />
      )}
    </div>
  )
}
