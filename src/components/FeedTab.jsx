// Вкладка «Лента» — теперь корневой раздел приложения.
//
// Раньше на её месте в нижней навигации была зелёная кнопка «＋», которая
// открывала лист добавления приёма пищи. Это дублировало то, что уже есть на
// экране дня: там кнопка «＋ Добавить продукт» стоит у каждого приёма и знает,
// в какой именно приём добавляет. Центральная кнопка угадывала приём по
// времени суток и потому регулярно угадывала неправильно.
//
// Лента живёт здесь, а не внутри экрана «Общение», чтобы не существовать в
// двух местах одновременно: в хабе вкладки «Лента» больше нет.
import { useState } from 'react'
import { useStore } from '../store.jsx'
import FeedScreen from './FeedScreen.jsx'
import PublicProfile from './PublicProfile.jsx'
import ChatView from './ChatView.jsx'

export default function FeedTab({ onChatClosed }) {
  const { supabaseEnabled, user } = useStore()
  const [profileUser, setProfileUser] = useState(null)
  const [chatFriend, setChatFriend] = useState(null)

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
          onOpenChat={(friend) => { setProfileUser(null); setChatFriend(friend) }}
        />
      )}

      {chatFriend && (
        <ChatView
          friend={chatFriend}
          onClose={() => { setChatFriend(null); onChatClosed?.() }}
        />
      )}
    </div>
  )
}
