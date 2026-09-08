// Приватность — структурированный раздел, а не одна большая форма.
//
// ─────────────────────────────────────────────────────────────────────────────
// ПОЧЕМУ РАЗДЕЛОВ ЧЕТЫРЕ, А НЕ ОДИН СПИСОК ИЗ ДВАДЦАТИ ТУМБЛЕРОВ
//
// Вопросов, на которые отвечает приватность, ровно четыре, и они разные по
// природе:
//
//   Аккаунт      — «кто вообще может видеть мой контент»;
//   Общение      — «кто может со мной связаться»;
//   Связи        — «кого я выделил или отгородил» (списки);
//   Дневник      — «кто видит, что я ем» — это EatAps, и здесь данные
//                  чувствительнее, чем записи и подписки.
//
// Смешать их в один экран значит спрятать закрытый аккаунт между «показывать,
// что я в сети» и списком заглушённых.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧЕСТНОСТЬ ПЕРЕКЛЮЧАТЕЛЕЙ
//
// Ни один тумблер здесь не работает «только в интерфейсе». Каждый пишет
// настройку на сервер, и её же читает RLS: при закрытом доступе сервер просто
// не отдаёт данные. Тумблер, который визуально меняется, но ничего не
// закрывает, вреднее пустого места — человек считает, что настроил.
import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../../store.jsx'
import {
  getPrivacy, setAccountPrivacy, setMessagePolicy, setGroupInvites,
  setActivityVisibility, setReadReceipts, setDiaryVisibility,
} from '../../lib/social.js'
import {
  DIARY_AUDIENCES, MESSAGE_POLICY, MESSAGE_AUDIENCES, GROUP_INVITE_POLICY,
} from '../../lib/relationship.js'
import { Panel, Group, Row, SwitchRow } from '../SettingsPanels.jsx'
import RelationListScreen from './RelationListScreen.jsx'

// Строка выбора одного значения из списка. Радиокнопки настроек в этом
// проекте всюду выглядят так; отдельный компонент — чтобы четыре списка на
// экране не разошлись между собой.
function ChoiceRow({ label, hint, checked, onClick }) {
  return (
    <button
      className="set-row"
      style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer' }}
      onClick={onClick}
      aria-pressed={checked}
      role="radio"
      aria-checked={checked}
    >
      <span style={{ flex: '0 0 auto', width: 18, color: 'var(--primary)' }}>{checked ? '✓' : ''}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block' }}>{label}</span>
        {hint && <span className="muted" style={{ fontSize: 13, display: 'block', lineHeight: 1.35 }}>{hint}</span>}
      </span>
    </button>
  )
}

export default function PrivacyHub({ onClose, onOpenProfile }) {
  const { user, supabaseEnabled } = useStore()
  const [p, setP] = useState(null)
  const [unavailable, setUnavailable] = useState(false)
  const [err, setErr] = useState(null)
  const [panel, setPanel] = useState(null)   // 'messages' | 'diary'
  const [list, setList] = useState(null)     // ключ RelationListScreen

  const load = useCallback(async () => {
    if (!supabaseEnabled || !user?.id) { setP(null); return }
    try {
      const res = await getPrivacy()
      setUnavailable(Boolean(res.unavailable))
      setP(res.settings || null)
    } catch (e) {
      setErr(e.message || 'Не удалось загрузить настройки')
    }
  }, [supabaseEnabled, user?.id])

  useEffect(() => { load() }, [load])

  // Оптимистично: переключатель обязан отвечать сразу. При ошибке —
  // возвращаем прежнее значение и показываем причину.
  const patch = async (next, fn) => {
    const prev = p
    setP((cur) => ({ ...cur, ...next }))
    setErr(null)
    const res = await fn()
    if (res?.error) { setP(prev); setErr(res.error) }
  }

  if (!supabaseEnabled || !user) {
    return (
      <Panel title="Приватность" onClose={onClose}>
        <Group title="Нужен аккаунт">
          <Row label="Войдите, чтобы настроить приватность" chevron={false} />
        </Group>
      </Panel>
    )
  }

  // Раздел недоступен — говорим прямо. Вечное «Загрузка…» здесь означало бы,
  // что человек ждёт того, чего не будет.
  if (unavailable) {
    return (
      <Panel title="Приватность" onClose={onClose}>
        <Group title="Раздел недоступен" note="База ещё не обновлена. Настройки появятся после обновления сервера.">
          <Row label="Попробовать снова" onClick={load} />
        </Group>
      </Panel>
    )
  }

  const diaryLabel = DIARY_AUDIENCES.find((a) => a.key === p?.diary_visibility)?.label

  return (
    <Panel title="Приватность" onClose={onClose}>
      {err && <p className="set-note" style={{ color: 'var(--danger)' }}>{err}</p>}

      <Group
        title="Аккаунт"
        note={p?.is_private
          ? 'Аккаунт закрыт. Записи, дневник, списки подписчиков и подписок видят только одобренные подписчики. Уже существующие подписчики сохраняются.'
          : 'Аккаунт открыт. Подписаться может любой без вашего согласия — записи для подписчиков откроются ему сразу.'}
      >
        {p === null ? (
          <Row label="Загрузка…" chevron={false} />
        ) : (
          <SwitchRow
            label="Закрытый аккаунт"
            hint="Новые подписчики — только по вашему одобрению"
            checked={Boolean(p.is_private)}
            onChange={(v) => patch({ is_private: v }, () => setAccountPrivacy(v))}
          />
        )}
      </Group>

      <Group title="Взаимодействие">
        <Row
          label="Сообщения"
          value={p ? summarizeMessages(p) : null}
          onClick={() => setPanel('messages')}
        />
        {p && (
          <SwitchRow
            label="Показывать, что я в сети"
            hint="Выключив, вы перестанете видеть и чужой статус"
            checked={Boolean(p.show_activity)}
            onChange={(v) => patch({ show_activity: v }, () => setActivityVisibility(v))}
          />
        )}
        {p && (
          <SwitchRow
            label="Отметки о прочтении"
            hint="Выключив, вы перестанете видеть и чужие"
            checked={Boolean(p.read_receipts)}
            onChange={(v) => patch({ read_receipts: v }, () => setReadReceipts(v))}
          />
        )}
      </Group>

      <Group title="Связи">
        <Row label="Близкие друзья" value={p?.close_friends_count || null} onClick={() => setList('close_friends')} />
        <Row label="Заблокированные" value={p?.blocked_count || null} onClick={() => setList('blocked')} />
        <Row label="Ограниченные" value={p?.restricted_count || null} onClick={() => setList('restricted')} />
        <Row label="Заглушённые" value={p?.muted_count || null} onClick={() => setList('muted')} />
      </Group>

      <Group
        title="Дневник питания"
        note="То, что вы едите, — самые личные данные в приложении. Ограничение стоит в базе, а не в интерфейсе: при закрытом доступе сервер просто не отдаёт эти записи."
      >
        <Row label="Кто видит дневник" value={diaryLabel} onClick={() => setPanel('diary')} />
        <Row label="Доступ по именам" value={p?.diary_access_count || null} onClick={() => setList('diary_access')} />
      </Group>

      {panel === 'messages' && (
        <MessagesPanel p={p} patch={patch} onClose={() => setPanel(null)} />
      )}

      {panel === 'diary' && (
        <Panel title="Кто видит дневник" onClose={() => setPanel(null)}>
          <Group
            title="Круг доступа"
            note="У закрытого аккаунта любой круг дополнительно требует одобренной подписки. Поимённый доступ и доступ тренера работают поверх этой настройки."
          >
            {DIARY_AUDIENCES.map((a) => (
              <ChoiceRow
                key={a.key}
                label={a.label}
                hint={a.hint}
                checked={p?.diary_visibility === a.key}
                onClick={() => patch({ diary_visibility: a.key }, () => setDiaryVisibility(a.key))}
              />
            ))}
          </Group>
          <Group title="Что видит тот, кому открыт дневник">
            <Row label="Имя, фото и «о себе»" chevron={false} />
            <Row label="Дневник питания и норму калорий" chevron={false} />
            <Row label="Составные блюда из дневника" chevron={false} />
          </Group>
          <Group title="Что не видит никто, кроме вас" note="Эти поля сервер не отдаёт вообще, ни при какой настройке.">
            <Row label="Вес, рост, возраст и пол" chevron={false} />
            <Row label="Цель и уровень активности" chevron={false} />
            <Row label="Настроение, самочувствие и заметки дня" chevron={false} />
            <Row label="Свои продукты, историю поиска и настройки" chevron={false} />
          </Group>
        </Panel>
      )}

      {list && (
        <RelationListScreen
          kind={list}
          onClose={() => { setList(null); load() }}
          onOpenProfile={onOpenProfile}
        />
      )}
    </Panel>
  )
}

// Отдельная панель, потому что вопросов здесь три и у каждого три ответа —
// девять состояний, которые в общем списке не читаются.
function MessagesPanel({ p, patch, onClose }) {
  const change = (key, value) => {
    const next = {
      following: key === 'msg_from_following' ? value : p.msg_from_following,
      followers: key === 'msg_from_followers' ? value : p.msg_from_followers,
      others:    key === 'msg_from_others'    ? value : p.msg_from_others,
    }
    patch({ [key]: value }, () => setMessagePolicy(next))
  }

  return (
    <Panel title="Сообщения" onClose={onClose}>
      <p className="set-note" style={{ margin: '0 4px 18px' }}>
        Для каждой группы людей выберите, куда попадёт их сообщение. «В „Запросы“»
        означает, что вы увидите сообщение и сами решите, отвечать ли, — человек
        при этом не узнает, что его письмо ждёт решения.
      </p>

      {MESSAGE_AUDIENCES.map((aud) => (
        <Group key={aud.key} title={aud.label} note={aud.hint}>
          {MESSAGE_POLICY.map((opt) => (
            <ChoiceRow
              key={opt.value}
              label={opt.label}
              hint={opt.hint}
              checked={p?.[aud.key] === opt.value}
              onClick={() => change(aud.key, opt.value)}
            />
          ))}
        </Group>
      ))}

      <Group title="Приглашения в группы" note="Кто может добавить вас в групповой чат без спроса.">
        {GROUP_INVITE_POLICY.map((opt) => (
          <ChoiceRow
            key={opt.value}
            label={opt.label}
            checked={p?.group_invites === opt.value}
            onClick={() => patch({ group_invites: opt.value }, () => setGroupInvites(opt.value))}
          />
        ))}
      </Group>
    </Panel>
  )
}

function summarizeMessages(p) {
  const label = (v) => MESSAGE_POLICY.find((x) => x.value === v)?.label || ''
  // Если все три одинаковы, одна подпись честнее перечисления.
  if (p.msg_from_following === p.msg_from_followers && p.msg_from_followers === p.msg_from_others) {
    return label(p.msg_from_following)
  }
  return 'Настроено'
}
