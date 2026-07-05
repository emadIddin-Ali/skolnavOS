import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { usePrincipal, usePermission, useCan } from '@/core/permissions/usePermission'
import { db, byId } from '@/data/db/store'
import type { Conversation } from '@/data/schema'
import {
  PageHeader, Card, Button, Badge, Avatar, Icon,
  TextInput, Select, Tabs, Modal, EmptyState, DeniedState,
} from '@/ui'
import { Popover, MenuItem } from '@/ui/Popover'
import { cn } from '@/lib/cn'
import { fmtRelative, fmtTime } from '@/lib/format'
import {
  KIND_LABEL, KIND_ICON, KIND_TONE,
  visibleConversations, conversationMessages, lastMessage, isMember,
  displayUserName, otherMembers, conversationTitle, studentContext,
  markConversationRead, markConversationUnread, toggleArchived,
  needsConfirmation, confirmRead, sendMessage,
  recipientOptions, createConversation,
  type RecipientOption,
} from './messagesService'

type TabKey = 'alla' | 'olasta' | 'arkiv'

export function MessagesPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'message')
  const canCreate = useCan('create', 'message')
  const [bump, force] = useReducer((n: number) => n + 1, 0)

  const [tab, setTab] = useState<TabKey>('alla')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendWarning, setSendWarning] = useState<string | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)

  const conversations = useMemo(
    () => visibleConversations(principal),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [principal, bump],
  )

  const counts = useMemo(() => ({
    alla: conversations.filter((c) => !c.archived).length,
    olasta: conversations.filter((c) => !c.archived && c.unread > 0).length,
    arkiv: conversations.filter((c) => c.archived).length,
  }), [conversations])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return conversations
      .filter((c) => (tab === 'arkiv' ? c.archived : tab === 'olasta' ? !c.archived && c.unread > 0 : !c.archived))
      .filter((c) => {
        if (!q) return true
        const names = otherMembers(principal, c).map((u) => displayUserName(principal, u)).join(' ')
        const last = lastMessage(c.id)?.body ?? ''
        return `${c.subject} ${names} ${last}`.toLowerCase().includes(q)
      })
  }, [conversations, tab, query, principal])

  const selectedConv = selectedId ? byId(db.data.conversations, selectedId) ?? null : null
  const messages = selectedConv ? conversationMessages(selectedConv.id) : []

  // Skrivbehörighet för vald konversation (hook måste alltid anropas).
  const canWriteSelected = usePermission(
    'create',
    'message',
    selectedConv
      ? { organizationId: selectedConv.organizationId, schoolId: selectedConv.schoolId ?? null, studentId: selectedConv.studentId }
      : undefined,
  ).allowed

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Meddelanden" icon="MessagesSquare" subtitle="Kontrollerad, formell skolkommunikation" />
        <Card><DeniedState reason={readDecision.reason} /></Card>
      </>
    )
  }

  function openConversation(id: string) {
    setSelectedId(id)
    setDraft('')
    setSendError(null)
    setSendWarning(null)
    markConversationRead(principal, id)
    force()
  }

  function handleSend() {
    if (!selectedConv) return
    const res = sendMessage(principal, selectedConv, draft)
    if (!res.ok) {
      setSendError(res.error ?? 'Kunde inte skicka meddelandet.')
      return
    }
    setDraft('')
    setSendError(null)
    setSendWarning(res.warning ?? null)
    force()
  }

  return (
    <>
      <PageHeader
        title="Meddelanden"
        icon="MessagesSquare"
        subtitle="Kontrollerad, formell skolkommunikation – inget socialt flöde"
        actions={
          canCreate ? (
            <Button size="sm" icon="PenSquare" onClick={() => setComposeOpen(true)}>
              Ny konversation
            </Button>
          ) : undefined
        }
      />

      <Card className="flex h-[calc(100dvh-15rem)] min-h-[540px] overflow-hidden p-0">
        {/* Vänster: inkorg */}
        <aside
          className={cn(
            'w-full flex-col border-border md:flex md:w-[340px] md:border-r lg:w-[380px]',
            selectedId ? 'hidden md:flex' : 'flex',
          )}
        >
          <div className="border-b border-border p-3">
            <TextInput
              icon="Search"
              placeholder="Sök i meddelanden…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Sök i meddelanden"
            />
            <div className="mt-2">
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'alla', label: 'Alla', count: counts.alla },
                  { value: 'olasta', label: 'Olästa', count: counts.olasta },
                  { value: 'arkiv', label: 'Arkiverade', count: counts.arkiv },
                ]}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <EmptyState
                icon={tab === 'arkiv' ? 'Archive' : 'Inbox'}
                title={query ? 'Inga träffar' : tab === 'olasta' ? 'Inga olästa' : 'Inga konversationer'}
                description={
                  query
                    ? 'Justera din sökning för att hitta fler konversationer.'
                    : canCreate
                      ? 'Starta en ny konversation för att komma igång.'
                      : 'Här visas dina konversationer när det finns några.'
                }
                actionLabel={!query && canCreate && tab !== 'arkiv' ? 'Ny konversation' : undefined}
                onAction={!query && canCreate && tab !== 'arkiv' ? () => setComposeOpen(true) : undefined}
              />
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((c) => (
                  <ConversationRow
                    key={c.id}
                    conv={c}
                    active={c.id === selectedId}
                    principal={principal}
                    onClick={() => openConversation(c.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Höger: konversation */}
        <section className={cn('min-w-0 flex-1 flex-col', selectedId ? 'flex' : 'hidden md:flex')}>
          {!selectedConv ? (
            <div className="grid h-full place-items-center">
              <EmptyState
                icon="MessageSquare"
                title="Välj en konversation"
                description="Öppna en konversation till vänster för att läsa och svara."
              />
            </div>
          ) : (
            <ConversationView
              conv={selectedConv}
              principal={principal}
              messages={messages}
              canWrite={canWriteSelected}
              isParticipant={isMember(principal, selectedConv)}
              draft={draft}
              onDraft={setDraft}
              onSend={handleSend}
              sendError={sendError}
              sendWarning={sendWarning}
              onBack={() => setSelectedId(null)}
              onConfirm={() => { confirmRead(principal, selectedConv); force() }}
              onArchive={() => { toggleArchived(principal, selectedConv.id); force() }}
              onMarkUnread={() => { markConversationUnread(selectedConv.id); setSelectedId(null); force() }}
            />
          )}
        </section>
      </Card>

      {composeOpen && (
        <ComposeModal
          principal={principal}
          onClose={() => setComposeOpen(false)}
          onCreated={(conv) => {
            setComposeOpen(false)
            force()
            openConversation(conv.id)
          }}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

function ConversationRow({
  conv, active, principal, onClick,
}: {
  conv: Conversation
  active: boolean
  principal: ReturnType<typeof usePrincipal>
  onClick: () => void
}) {
  const others = otherMembers(principal, conv)
  const primary = others[0]
  const last = lastMessage(conv.id)
  const lastMine = last?.senderUserId === principal.userId
  const isGroup = conv.kind === 'klass' || conv.kind === 'avdelning' || (conv.kind === 'personal' && others.length > 1)

  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          'flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:bg-surface-2',
          active && 'bg-primary-soft/40',
        )}
        aria-current={active}
      >
        {isGroup ? (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-muted">
            <Icon name={KIND_ICON[conv.kind]} className="h-[18px] w-[18px]" />
          </span>
        ) : (
          <Avatar
            name={primary ? displayUserName(principal, primary) : 'Okänd'}
            color={primary?.avatarColor}
            protected={primary?.protectedIdentity && !principal.protectedClearance}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={cn('truncate text-sm', conv.unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink')}>
              {conversationTitle(principal, conv)}
            </span>
            <span className="ml-auto shrink-0 text-2xs text-ink-subtle">{fmtRelative(conv.lastMessageAt)}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <Badge tone={KIND_TONE[conv.kind]} className="px-1.5 py-0 text-2xs">{KIND_LABEL[conv.kind]}</Badge>
            <span className="truncate text-xs text-ink-subtle">{conv.subject}</span>
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span className={cn('truncate text-xs', conv.unread > 0 ? 'text-ink-muted' : 'text-ink-subtle')}>
              {last ? `${lastMine ? 'Du: ' : ''}${last.body}` : 'Inga meddelanden än'}
            </span>
            {conv.unread > 0 && (
              <span className="ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-pill bg-primary px-1.5 text-2xs font-semibold text-primary-fg tabular-nums">
                {conv.unread}
              </span>
            )}
            {conv.requiresConfirmation && (
              <Icon name="BadgeCheck" className="h-3.5 w-3.5 shrink-0 text-info" aria-label="Kräver läsbekräftelse" />
            )}
          </span>
        </span>
      </button>
    </li>
  )
}

function ConversationView({
  conv, principal, messages, canWrite, isParticipant,
  draft, onDraft, onSend, sendError, sendWarning,
  onBack, onConfirm, onArchive, onMarkUnread,
}: {
  conv: Conversation
  principal: ReturnType<typeof usePrincipal>
  messages: ReturnType<typeof conversationMessages>
  canWrite: boolean
  isParticipant: boolean
  draft: string
  onDraft: (v: string) => void
  onSend: () => void
  sendError: string | null
  sendWarning: string | null
  onBack: () => void
  onConfirm: () => void
  onArchive: () => void
  onMarkUnread: () => void
}) {
  const ctx = studentContext(principal, conv)
  const mustConfirm = needsConfirmation(principal, conv)
  const others = otherMembers(principal, conv)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [conv.id, messages.length])

  return (
    <>
      {/* Rubrik */}
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          onClick={onBack}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-field text-ink-muted hover:bg-surface-2 md:hidden"
          aria-label="Tillbaka till inkorgen"
        >
          <Icon name="ArrowLeft" className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-semibold text-ink">{conv.subject}</h2>
            <Badge tone={KIND_TONE[conv.kind]} icon={KIND_ICON[conv.kind]}>{KIND_LABEL[conv.kind]}</Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-subtle">
            {others.map((u) => displayUserName(principal, u)).join(', ') || 'Endast du'}
            {ctx && <> · Elev: {ctx.name} ({ctx.gradeLabel})</>}
          </p>
        </div>
        <Popover
          align="end"
          width="w-56"
          trigger={
            <button className="grid h-9 w-9 shrink-0 place-items-center rounded-field text-ink-muted hover:bg-surface-2" aria-label="Fler åtgärder">
              <Icon name="MoreVertical" className="h-5 w-5" />
            </button>
          }
        >
          {(close) => (
            <>
              {conv.requiresConfirmation && (
                <MenuItem icon="BadgeCheck" onClick={() => { onConfirm(); close() }}>Bekräfta läst</MenuItem>
              )}
              <MenuItem icon="MailOpen" onClick={() => { onMarkUnread(); close() }}>Markera som oläst</MenuItem>
              <MenuItem icon={conv.archived ? 'ArchiveRestore' : 'Archive'} onClick={() => { onArchive(); close() }}>
                {conv.archived ? 'Återställ från arkiv' : 'Arkivera'}
              </MenuItem>
            </>
          )}
        </Popover>
      </header>

      {/* Skyddad identitet-varning */}
      {ctx?.protectedMasked && (
        <div className="flex items-center gap-2 border-b border-warning-soft bg-warning-soft/50 px-4 py-2 text-xs text-warning">
          <Icon name="ShieldAlert" className="h-4 w-4 shrink-0" />
          Skyddad identitet – elevens namn maskeras. Öppen visning kräver klarering.
        </div>
      )}

      {/* Läsbekräftelse */}
      {mustConfirm && (
        <div className="flex flex-wrap items-center gap-2 border-b border-info-soft bg-info-soft/50 px-4 py-2.5 text-xs text-info">
          <Icon name="BadgeCheck" className="h-4 w-4 shrink-0" />
          <span className="flex-1">Den här konversationen kräver att du bekräftar att du läst.</span>
          <Button size="sm" variant="secondary" icon="Check" onClick={onConfirm}>Bekräfta läst</Button>
        </div>
      )}

      {/* Meddelanden */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-surface-2/30 px-4 py-4">
        {messages.length === 0 ? (
          <div className="grid h-full place-items-center">
            <EmptyState icon="MessageSquarePlus" title="Inga meddelanden än" description="Skriv det första meddelandet nedan." />
          </div>
        ) : (
          messages.map((m, i) => {
            const mine = m.senderUserId === principal.userId
            const sender = byId(db.data.users, m.senderUserId)
            const prev = messages[i - 1]
            const showMeta = !prev || prev.senderUserId !== m.senderUserId
            const readByOthers = conv.memberUserIds.filter((id) => id !== principal.userId && m.readBy.includes(id))
            return (
              <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                {showMeta && (
                  <span className="mb-1 px-1 text-2xs text-ink-subtle">
                    {mine ? 'Du' : displayUserName(principal, sender)} · {fmtTime(m.sentAt)}
                  </span>
                )}
                <div
                  className={cn(
                    'max-w-[85%] rounded-panel px-3.5 py-2 text-sm sm:max-w-[75%]',
                    mine
                      ? 'bg-primary text-primary-fg rounded-br-sm'
                      : 'border border-border bg-surface text-ink rounded-bl-sm',
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                </div>
                {mine && (
                  <span className="mt-0.5 flex items-center gap-1 px-1 text-2xs text-ink-subtle">
                    <Icon name={readByOthers.length > 0 ? 'CheckCheck' : 'Check'} className={cn('h-3 w-3', readByOthers.length > 0 && 'text-info')} />
                    {readByOthers.length > 0 ? 'Läst' : 'Skickat'}
                    {m.confirmed && <> · bekräftat</>}
                  </span>
                )}
              </div>
            )
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Compose */}
      <footer className="border-t border-border p-3">
        {isParticipant && canWrite ? (
          <>
            {sendError && (
              <div className="mb-2 flex items-center gap-2 rounded-field bg-danger-soft px-3 py-2 text-xs text-danger">
                <Icon name="TriangleAlert" className="h-4 w-4 shrink-0" />
                <span>{sendError}</span>
              </div>
            )}
            {sendWarning && !sendError && (
              <div className="mb-2 flex items-center gap-2 rounded-field bg-warning-soft px-3 py-2 text-xs text-warning">
                <Icon name="Gauge" className="h-4 w-4 shrink-0" />
                <span>{sendWarning}</span>
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => onDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSend() }
                }}
                rows={2}
                placeholder="Skriv ett meddelande…"
                className="max-h-32 min-h-[44px] w-full resize-none rounded-field border border-border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                aria-label="Nytt meddelande"
              />
              <Button icon="Send" onClick={onSend} disabled={!draft.trim()} aria-label="Skicka">
                <span className="hidden sm:inline">Skicka</span>
              </Button>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-2xs text-ink-subtle">
              <Icon name="ShieldCheck" className="h-3 w-3 shrink-0" />
              Inga känsliga uppgifter skickas i push eller e-post – endast en avisering om att du har ett nytt meddelande.
            </p>
          </>
        ) : !isParticipant ? (
          <div className="flex items-center gap-2 rounded-field bg-surface-2 px-3 py-2.5 text-xs text-ink-muted">
            <Icon name="Eye" className="h-4 w-4 shrink-0" />
            Du läser den här konversationen via din översiktsbehörighet. Åtkomsten loggas.
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-field bg-surface-2 px-3 py-2.5 text-xs text-ink-muted">
            <Icon name="Lock" className="h-4 w-4 shrink-0" />
            Du har läsbehörighet för den här konversationen men kan inte svara.
          </div>
        )}
      </footer>
    </>
  )
}

/* ------------------------------------------------------------------ */

function ComposeModal({
  principal, onClose, onCreated,
}: {
  principal: ReturnType<typeof usePrincipal>
  onClose: () => void
  onCreated: (conv: Conversation) => void
}) {
  const options = useMemo(() => recipientOptions(principal), [principal])
  const [recipientKey, setRecipientKey] = useState<string>(options[0] ? keyFor(options[0]) : '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recipient = options.find((o) => keyFor(o) === recipientKey)

  function handleCreate() {
    if (!recipient) {
      setError('Välj en mottagare.')
      return
    }
    const res = createConversation(principal, { recipient, subject, body })
    if (!res.ok || !res.conv) {
      setError(res.error ?? 'Kunde inte skapa konversationen.')
      return
    }
    onCreated(res.conv)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ny konversation"
      description="Formell kontakt inom din behörighet."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Avbryt</Button>
          <Button icon="Send" onClick={handleCreate} disabled={options.length === 0}>Skicka</Button>
        </>
      }
    >
      {options.length === 0 ? (
        <EmptyState
          icon="UserX"
          title="Inga tillgängliga mottagare"
          description="Du har för närvarande ingen behörighet att inleda nya konversationer."
        />
      ) : (
        <div className="space-y-4 py-1">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">Mottagare</label>
            <Select value={recipientKey} onChange={(e) => setRecipientKey(e.target.value)} aria-label="Mottagare">
              {options.map((o) => (
                <option key={keyFor(o)} value={keyFor(o)}>
                  {o.label} — {o.sublabel}
                </option>
              ))}
            </Select>
            {recipient && (
              <p className="mt-1.5 flex items-center gap-1.5 text-2xs text-ink-subtle">
                <Icon name={KIND_ICON[recipient.kind]} className="h-3 w-3" />
                Typ: {KIND_LABEL[recipient.kind]}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">Ämne</label>
            <TextInput
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="T.ex. Fråga om läxa"
              aria-label="Ämne"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-muted">Meddelande</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Skriv ditt meddelande…"
              className="w-full resize-none rounded-field border border-border bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-label="Meddelande"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-field bg-danger-soft px-3 py-2 text-xs text-danger">
              <Icon name="TriangleAlert" className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-field bg-surface-2 px-3 py-2.5 text-2xs text-ink-subtle">
            <Icon name="Info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Mottagarlistan är begränsad efter din behörighet. Aviseringar innehåller aldrig känsliga
              uppgifter – och skyddad data kan inte massexporteras.
            </span>
          </div>
        </div>
      )}
    </Modal>
  )
}

function keyFor(o: RecipientOption): string {
  return `${o.userId}:${o.studentId ?? ''}`
}
