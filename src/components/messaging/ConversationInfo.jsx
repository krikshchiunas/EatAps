// Сведения о диалоге: участники, вложения, поиск, заглушение, выход.
//
// ─────────────────────────────────────────────────────────────────────────────
// ОДИН ЭКРАН НА ЛИЧНЫЙ И ГРУППОВОЙ ДИАЛОГ
//
// Различий между ними меньше, чем кажется: и там и там есть заглушение, поиск,
// вложения, удаление переписки у себя. Отличается только верх — профиль
// собеседника против названия и состава — и низ: у группы «выйти», у личного
// «заблокировать».
//
// Права на управление составом ПРОВЕРЯЕТ СЕРВЕР. Здесь кнопки просто не
// показываются тем, у кого роли нет, — но это удобство, а не защита: попытка
// вызвать RPC без роли вернёт 42501 независимо от того, что нарисовано.
import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../../store.jsx'
import {
  conversationInfo, conversationMembers, renameConversation, addMembers,
  removeMember, setMemberRole, leaveConversation, setConversationMuted,
  setConversationArchived, clearConversation, isMuted, MUTE_OPTIONS,
} from '../../lib/messaging.js'
import { block, setRestricted, getRelationship } from '../../lib/social.js'
import { EMPTY_RELATIONSHIP } from '../../lib/relationship.js'
import { Avatar } from '../Avatar.jsx'
import { Group, Row, SwitchRow } from '../SettingsPanels.jsx'
import PushScreen from '../PushScreen.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import ActionSheet, { ICONS } from '../social/ActionSheet.jsx'
import ReportSheet from '../social/ReportSheet.jsx'
import SharedMedia from './SharedMedia.jsx'
import ConversationSearch from './ConversationSearch.jsx'
import NewMessageScreen from './NewMessageScreen.jsx'

export default function ConversationInfo({
  conversationId, onClose, onOpenProfile, onLeft, onJumpToMessage,
}) {
  const { user } = useStore()
  const myId = user?.id || ''

  const [info, setInfo] = useState(null)
  const [members, setMembers] = useState([])
  const [rel, setRel] = useState({ ...EMPTY_RELATIONSHIP })
  const [err, setErr] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [panel, setPanel] = useState(null)      // 'media' | 'search' | 'add'
  const [confirm, setConfirm] = useState(null)
  const [memberMenu, setMemberMenu] = useState(null)
  const [muteMenu, setMuteMenu] = useState(false)
  const [report, setReport] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const i = await conversationInfo(conversationId)
      setInfo(i)
      setTitle(i?.title || '')
      if (i?.kind === 'group') setMembers(await conversationMembers(conversationId))
      else if (i?.peer_id) setRel(await getRelationship(i.peer_id))
    } catch (e) { setErr(e.message || 'Не удалось загрузить') }
  }, [conversationId])

  useEffect(() => { load() }, [load])

  const act = async (fn, after) => {
    setErr(null)
    const res = await fn()
    if (res?.error) { setErr(res.error); return }
    if (after) after(); else load()
  }

  if (!info) {
    return (
      <PushScreen onClose={onClose}>
        {(close) => (
          <div className="screen">
            <div className="row gap8" style={{ alignItems: 'center', marginBottom: 14 }}>
              <button className="iconbtn" onClick={close} aria-label="Назад" style={{ fontSize: 22 }}>‹</button>
              <h1 className="h1" style={{ margin: 0, fontSize: 24 }}>Диалог</h1>
            </div>
            {err
              ? <p style={{ fontSize: 14, color: 'var(--danger)' }}>{err}</p>
              : <div className="skel skel-card" style={{ height: 120, borderRadius: 18 }} />}
          </div>
        )}
      </PushScreen>
    )
  }

  const isGroup = info.kind === 'group'
  const canManage = info.my_role === 'owner' || info.my_role === 'admin'
  const muted = isMuted({ mutedUntil: info.muted_until })
  const name = isGroup ? (info.title || 'Группа') : null

  return (
    <PushScreen onClose={onClose}>
      {(close) => (
        <div className="screen">
          <div className="row gap8" style={{ alignItems: 'center', marginBottom: 16 }}>
            <button className="iconbtn" onClick={close} aria-label="Назад" style={{ fontSize: 22, flex: '0 0 auto' }}>‹</button>
            <h1 className="h1" style={{ margin: 0, fontSize: 24 }}>Диалог</h1>
          </div>

          {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</p>}

          {isGroup ? (
            <div style={{ textAlign: 'center', marginBottom: 18 }}>
              <Avatar src={info.avatar_url} name={name} size={76} />
              {renaming ? (
                <div style={{ marginTop: 12 }}>
                  <input
                    className="input"
                    value={title}
                    maxLength={80}
                    onChange={(e) => setTitle(e.target.value)}
                    aria-label="Название группы"
                    style={{ marginBottom: 8 }}
                  />
                  <div className="row gap8">
                    <button className="btn ghost" style={{ flex: 1 }} onClick={() => { setRenaming(false); setTitle(info.title || '') }}>
                      Отмена
                    </button>
                    <button className="btn" style={{ flex: 1 }} onClick={() => act(() => renameConversation(conversationId, title), () => { setRenaming(false); load() })}>
                      Сохранить
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="h1" style={{ fontSize: 21, marginTop: 10 }}>{name}</h2>
                  <div className="muted" style={{ fontSize: 13.5 }}>{info.members_count} участников</div>
                  {canManage && (
                    <button
                      className="btn ghost"
                      style={{ width: 'auto', padding: '0 18px', margin: '10px auto 0', height: 34, fontSize: 14 }}
                      onClick={() => setRenaming(true)}
                    >
                      Переименовать
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <Group title="Собеседник">
              <Row label="Открыть профиль" onClick={() => info.peer_id && onOpenProfile?.(info.peer_id)} />
            </Group>
          )}

          <Group title="Переписка">
            <SwitchRow
              label="Заглушить"
              hint="Сообщения продолжат приходить, но без уведомлений"
              checked={muted}
              onChange={(v) => (v
                ? setMuteMenu(true)
                : act(() => setConversationMuted(conversationId, null)))}
            />
            <SwitchRow
              label="В архиве"
              hint="Новое сообщение вернёт переписку в чаты"
              checked={Boolean(info.archived)}
              onChange={(v) => act(() => setConversationArchived(conversationId, v))}
            />
            <Row label="Поиск по сообщениям" onClick={() => setPanel('search')} />
            <Row label="Вложения" value={info.media_count || null} onClick={() => setPanel('media')} />
          </Group>

          {isGroup && (
            <Group title={`Участники · ${info.members_count}`}>
              {canManage && <Row label="Добавить людей" onClick={() => setPanel('add')} />}
              {members.map((m) => (
                <div key={m.user_id} className="set-row">
                  <Avatar src={m.avatar_url} name={m.display_name || m.username} size={30} />
                  <button
                    onClick={() => onOpenProfile?.(m.user_id)}
                    style={{
                      minWidth: 0, flex: 1, textAlign: 'left', background: 'none',
                      border: 0, color: 'inherit', cursor: 'pointer', padding: 0,
                    }}
                  >
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.display_name || m.username}{m.user_id === myId ? ' (вы)' : ''}
                    </span>
                    {m.role !== 'member' && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {m.role === 'owner' ? 'создатель' : 'администратор'}
                      </span>
                    )}
                  </button>
                  {canManage && m.user_id !== myId && m.role !== 'owner' && (
                    <button
                      style={{ marginLeft: 'auto', color: 'var(--ink-3)', flex: '0 0 auto', padding: '4px 8px' }}
                      onClick={() => setMemberMenu(m)}
                      aria-label={`Действия с участником ${m.display_name || m.username}`}
                    >
                      ⋯
                    </button>
                  )}
                </div>
              ))}
            </Group>
          )}

          <Group title="Действия">
            {!isGroup && info.peer_id && (
              <Row
                label={rel.restricted ? 'Снять ограничение' : 'Ограничить'}
                onClick={() => act(() => setRestricted(info.peer_id, !rel.restricted))}
              />
            )}
            <Row label="Пожаловаться" onClick={() => setReport(true)} danger />
            <Row
              label="Удалить переписку"
              danger
              onClick={() => setConfirm({
                text: 'Удалить переписку? История исчезнет только у вас — у собеседника она останется.',
                yes: () => act(() => clearConversation(conversationId), () => { close(); onLeft?.() }),
              })}
            />
            {isGroup ? (
              <Row
                label="Выйти из группы"
                danger
                onClick={() => setConfirm({
                  text: 'Выйти из группы? Вы перестанете получать сообщения. Вернуться можно только по приглашению участника.',
                  yes: () => act(() => leaveConversation(conversationId), () => { close(); onLeft?.() }),
                })}
              />
            ) : info.peer_id && (
              <Row
                label="Заблокировать"
                danger
                onClick={() => setConfirm({
                  text: 'Заблокировать этого человека? Подписки в обе стороны будут удалены, писать он больше не сможет.',
                  yes: () => act(() => block(info.peer_id), () => { close(); onLeft?.() }),
                })}
              />
            )}
          </Group>

          {panel === 'media' && (
            <SharedMedia conversationId={conversationId} onClose={() => setPanel(null)} />
          )}

          {panel === 'search' && (
            <ConversationSearch
              conversationId={conversationId}
              onClose={() => setPanel(null)}
              onPick={(m) => { setPanel(null); close(); onJumpToMessage?.(m) }}
            />
          )}

          {panel === 'add' && (
            <NewMessageScreen
              onClose={() => setPanel(null)}
              onOpenConversation={() => setPanel(null)}
              /* Экран выбора людей один на «написать» и «добавить в группу»:
                 второй такой же список разошёлся бы с первым на первой правке.
                 Здесь он используется только как выбор, а действие подменено. */
              onPickMany={(ids) => act(() => addMembers(conversationId, ids), () => { setPanel(null); load() })}
            />
          )}

          {muteMenu && (
            <ActionSheet
              title="Заглушить"
              items={MUTE_OPTIONS.map((o) => ({
                key: o.key, label: o.label, icon: ICONS.mute,
                run: () => act(() => setConversationMuted(conversationId, Date.now() + o.ms)),
              }))}
              onClose={() => setMuteMenu(false)}
            />
          )}

          {memberMenu && (
            <ActionSheet
              title={memberMenu.display_name || memberMenu.username}
              items={[
                info.my_role === 'owner' ? {
                  key: 'role',
                  label: memberMenu.role === 'admin' ? 'Снять администратора' : 'Сделать администратором',
                  icon: ICONS.star,
                  run: () => act(() => setMemberRole(conversationId, memberMenu.user_id, memberMenu.role === 'admin' ? 'member' : 'admin')),
                } : null,
                {
                  key: 'remove',
                  label: 'Убрать из группы',
                  icon: ICONS.removeUser,
                  danger: true,
                  run: () => act(() => removeMember(conversationId, memberMenu.user_id)),
                },
              ].filter(Boolean)}
              onClose={() => setMemberMenu(null)}
            />
          )}

          {confirm && (
            <ConfirmDialog
              text={confirm.text}
              yesLabel="Подтвердить"
              noLabel="Отмена"
              onYes={() => { const y = confirm.yes; setConfirm(null); y() }}
              onNo={() => setConfirm(null)}
            />
          )}

          {report && (
            <ReportSheet
              kind="conversation"
              targetId={conversationId}
              name={name}
              onClose={() => setReport(false)}
            />
          )}
        </div>
      )}
    </PushScreen>
  )
}
