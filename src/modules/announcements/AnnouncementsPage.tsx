import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, Card, StatCard, Tabs, Button, Badge, Modal, StepIndicator,
  TextInput, Select, Segmented, Icon, EmptyState, LoadingRows, toast,
} from '@/ui'
import type { Tone } from '@/ui'
import { Popover, MenuItem } from '@/ui/Popover'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { ForbiddenError, type Principal } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, byId } from '@/data/db/store'
import type { Announcement } from '@/data/schema'
import { fmtDateTime, fmtRelative } from '@/lib/format'
import {
  AUDIENCE_LABEL, type Audience, type CreateAnnouncementInput,
  createAnnouncement, archiveAnnouncement, confirmAnnouncementRead,
  confirmationCount, hasConfirmed, isScheduled, visibleFor,
} from './service'

// ---- Presentationskartor ----
const AUDIENCE_META: Record<Audience, { tone: Tone; icon: string }> = {
  skola: { tone: 'primary', icon: 'School' },
  klass: { tone: 'info', icon: 'Users' },
  personal: { tone: 'accent', icon: 'Briefcase' },
  vardnadshavare: { tone: 'success', icon: 'HandHeart' },
  organisation: { tone: 'neutral', icon: 'Building2' },
}

/** Statisk klasskarta (Tailwind kräver kompletta klassnamn). */
const TONE_ICON_CLS: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-muted',
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
}

const AUDIENCE_HINT: Record<Audience, string> = {
  skola: 'Alla elever, vårdnadshavare och personal på skolan.',
  klass: 'Elever och vårdnadshavare i berörda klasser.',
  personal: 'Endast skolans personal.',
  vardnadshavare: 'Alla vårdnadshavare på skolan.',
  organisation: 'Samtliga skolor i organisationen.',
}

type TabKey = 'alla' | 'viktiga' | 'bekraftelse' | 'schemalagda'

const TEXTAREA_CLS =
  'w-full rounded-field border border-border bg-surface p-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'

export function AnnouncementsPage() {
  const principal = usePrincipal()
  const canPublish = usePermission('create', 'announcement').allowed
  const canArchive = usePermission('delete', 'announcement').allowed
  const isReader =
    principal.role === 'vardnadshavare' ||
    principal.role === 'elev_grund' ||
    principal.role === 'elev_gy'

  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('alla')
  const [refresh, bump] = useReducer((x: number) => x + 1, 0)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 220)
    return () => clearTimeout(t)
  }, [])

  const nowIso = new Date().toISOString()

  // Målgruppsfiltrerad lista. Schemalagda anslag visas endast för publicerare.
  const items = useMemo(() => {
    void refresh
    return db.data.announcements
      .filter((a) => !a.deletedAt)
      .filter((a) => visibleFor(principal, a))
      .filter((a) => canPublish || !isScheduled(a, nowIso))
      .sort((a, b) =>
        (b.scheduledFor ?? b.publishedAt).localeCompare(a.scheduledFor ?? a.publishedAt),
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principal, canPublish, refresh])

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { alla: items.length, viktiga: 0, bekraftelse: 0, schemalagda: 0 }
    for (const a of items) {
      if (a.urgent) c.viktiga += 1
      if (a.confirmationsRequired) c.bekraftelse += 1
      if (isScheduled(a, nowIso)) c.schemalagda += 1
    }
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const visible = useMemo(() => {
    switch (tab) {
      case 'viktiga':
        return items.filter((a) => a.urgent)
      case 'bekraftelse':
        return items.filter((a) => a.confirmationsRequired)
      case 'schemalagda':
        return items.filter((a) => isScheduled(a, nowIso))
      default:
        return items
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, tab])

  const tabs: { value: TabKey; label: string; count: number }[] = [
    { value: 'alla', label: 'Alla', count: counts.alla },
    { value: 'viktiga', label: 'Viktiga', count: counts.viktiga },
    { value: 'bekraftelse', label: 'Kräver bekräftelse', count: counts.bekraftelse },
    ...(canPublish
      ? [{ value: 'schemalagda' as TabKey, label: 'Schemalagda', count: counts.schemalagda }]
      : []),
  ]

  function handleArchive(a: Announcement) {
    try {
      archiveAnnouncement(principal, a.id)
      toast.success('Anslaget arkiverades', `«${a.title}» visas inte längre för läsarna.`)
      bump()
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Kunde inte arkivera', 'Försök igen om en stund.')
    }
  }

  function handleConfirm(a: Announcement) {
    try {
      confirmAnnouncementRead(principal, a.id)
      toast.success('Tack för din bekräftelse', 'Skolan ser att du har läst anslaget.')
      bump()
    } catch {
      toast.error('Kunde inte bekräfta', 'Försök igen om en stund.')
    }
  }

  return (
    <>
      <PageHeader
        title="Anslag"
        icon="Megaphone"
        subtitle={
          canPublish
            ? 'Publicera information till skolans målgrupper och följ läsbekräftelser.'
            : 'Information från skolan – viktiga anslag kan kräva läsbekräftelse.'
        }
        actions={
          canPublish ? (
            <Button icon="Plus" onClick={() => setCreateOpen(true)}>
              Nytt anslag
            </Button>
          ) : undefined
        }
      />

      {canPublish && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Aktiva anslag"
            value={counts.alla - counts.schemalagda}
            icon="Megaphone"
            tone="primary"
          />
          <StatCard
            label="Markerade viktiga"
            value={counts.viktiga}
            icon="TriangleAlert"
            tone={counts.viktiga ? 'warning' : 'neutral'}
          />
          <StatCard
            label="Schemalagda"
            value={counts.schemalagda}
            icon="CalendarClock"
            tone={counts.schemalagda ? 'info' : 'neutral'}
          />
        </div>
      )}

      <div className="mb-4">
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
      </div>

      {loading ? (
        <Card>
          <LoadingRows rows={4} />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="Megaphone"
            title={tab === 'alla' ? 'Inga anslag att visa' : 'Inga anslag i den här vyn'}
            description={
              canPublish
                ? 'Publicera ett anslag för att nå elever, vårdnadshavare eller personal.'
                : 'När skolan publicerar information visas den här.'
            }
            actionLabel={canPublish && tab === 'alla' ? 'Nytt anslag' : undefined}
            onAction={canPublish && tab === 'alla' ? () => setCreateOpen(true) : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((a) => (
            <AnnouncementCard
              key={a.id}
              announcement={a}
              principal={principal}
              isReader={isReader}
              canArchive={canArchive}
              scheduled={isScheduled(a, nowIso)}
              onArchive={() => handleArchive(a)}
              onConfirm={() => handleConfirm(a)}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <NewAnnouncementModal
          principal={principal}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            bump()
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Anslagskort
// ---------------------------------------------------------------------------

function AnnouncementCard({
  announcement: a,
  principal,
  isReader,
  canArchive,
  scheduled,
  onArchive,
  onConfirm,
}: {
  announcement: Announcement
  principal: Principal
  isReader: boolean
  canArchive: boolean
  scheduled: boolean
  onArchive: () => void
  onConfirm: () => void
}) {
  const meta = AUDIENCE_META[a.audience]
  const publisher = byId(db.data.users, a.publishedBy)
  const confirmed = hasConfirmed(a, principal.userId)
  const confirmCount = a.confirmationsRequired ? confirmationCount(a) : 0

  return (
    <Card>
      <div className="flex items-start gap-4 p-5">
        <span
          className={`hidden h-10 w-10 shrink-0 place-items-center rounded-field sm:grid ${TONE_ICON_CLS[meta.tone]}`}
        >
          <Icon name={meta.icon} className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-ink">{a.title}</h3>
            {a.urgent && (
              <Badge tone="danger" icon="TriangleAlert">
                Viktigt
              </Badge>
            )}
            {scheduled && a.scheduledFor && (
              <Badge tone="warning" icon="CalendarClock">
                Schemalagd · {fmtDateTime(a.scheduledFor)}
              </Badge>
            )}
          </div>

          <p className="mt-1.5 text-sm text-ink-muted whitespace-pre-line">{a.body}</p>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={meta.tone} icon={meta.icon}>
              {AUDIENCE_LABEL[a.audience]}
            </Badge>
            {a.confirmationsRequired && (
              <Badge tone="info" icon="CheckCheck">
                {confirmCount} {confirmCount === 1 ? 'bekräftelse' : 'bekräftelser'}
              </Badge>
            )}
            <span className="text-2xs text-ink-subtle">
              {scheduled ? 'Skapad' : 'Publicerad'} {fmtRelative(a.publishedAt)}
              {publisher ? ` · ${publisher.name}` : ''}
            </span>
          </div>

          {isReader && a.confirmationsRequired && !scheduled && (
            <div className="mt-4">
              {confirmed ? (
                <Badge tone="success" icon="CircleCheck">
                  Du har bekräftat att du läst anslaget
                </Badge>
              ) : (
                <Button size="sm" icon="CheckCheck" onClick={onConfirm}>
                  Bekräfta läst
                </Button>
              )}
            </div>
          )}
        </div>

        {canArchive && (
          <Popover
            width="w-52"
            trigger={
              <Button
                variant="ghost"
                size="icon"
                icon="ChevronDown"
                aria-label="Fler åtgärder"
                title="Fler åtgärder"
              />
            }
          >
            {(close) => (
              <MenuItem
                icon="Archive"
                danger
                onClick={() => {
                  close()
                  onArchive()
                }}
              >
                Arkivera anslaget
              </MenuItem>
            )}
          </Popover>
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Nytt anslag – flerstegsflöde
// ---------------------------------------------------------------------------

const CREATE_STEPS = [{ label: 'Innehåll' }, { label: 'Målgrupp' }, { label: 'Publicering' }]

function NewAnnouncementModal({
  principal,
  onClose,
  onCreated,
}: {
  principal: Principal
  onClose: () => void
  onCreated: () => void
}) {
  const [step, setStep] = useState(0)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<Audience>('skola')
  const [urgent, setUrgent] = useState(false)
  const [requireConfirm, setRequireConfirm] = useState(false)
  const [publishMode, setPublishMode] = useState<'nu' | 'senare'>('nu')
  const [scheduledAt, setScheduledAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const contentValid = title.trim().length >= 3 && body.trim().length >= 10
  const scheduleValid =
    publishMode === 'nu' || (scheduledAt !== '' && new Date(scheduledAt).getTime() > Date.now())
  const canNext = step === 0 ? contentValid : true

  function submit() {
    setError(null)
    if (!contentValid) {
      setError('Fyll i rubrik (minst 3 tecken) och brödtext (minst 10 tecken).')
      return
    }
    if (!scheduleValid) {
      setError('Ange en schemalagd tid som ligger framåt i tiden.')
      return
    }
    setBusy(true)
    const input: CreateAnnouncementInput = {
      title,
      body,
      audience,
      urgent,
      confirmationsRequired: requireConfirm,
      scheduledFor: publishMode === 'senare' ? new Date(scheduledAt).toISOString() : null,
    }
    try {
      const created = createAnnouncement(principal, input)
      if (created.scheduledFor) {
        toast.success('Anslaget är schemalagt', `Publiceras ${fmtDateTime(created.scheduledFor)}.`)
      } else {
        toast.success('Anslaget är publicerat', `Målgrupp: ${AUDIENCE_LABEL[audience].toLowerCase()}.`)
      }
      onCreated()
    } catch (e) {
      if (e instanceof RateLimitedError) {
        setError(e.message)
        toast.warning('Publiceringsgränsen är nådd', e.message)
      } else if (e instanceof ForbiddenError) {
        setError(e.message)
        toast.error('Åtkomst nekad', e.message)
      } else {
        setError('Anslaget kunde inte publiceras just nu. Försök igen om en stund.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nytt anslag"
      description="Innehåll, målgrupp och publicering i tre steg."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button
            variant="ghost"
            icon="ChevronLeft"
            onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}
          >
            {step === 0 ? 'Avbryt' : 'Tillbaka'}
          </Button>
          {step < 2 ? (
            <Button
              iconRight="ChevronRight"
              disabled={!canNext}
              title={canNext ? undefined : 'Fyll i rubrik och brödtext först'}
              onClick={() => setStep((s) => s + 1)}
            >
              Nästa
            </Button>
          ) : (
            <Button icon="Send" loading={busy} disabled={!scheduleValid} onClick={submit}>
              {publishMode === 'senare' ? 'Schemalägg' : 'Publicera'}
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-5">
        <StepIndicator steps={CREATE_STEPS} current={step} />
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Steg 1: Innehåll */}
      {step === 0 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Rubrik</label>
            <TextInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="T.ex. Studiedag fredag 13 mars"
            />
            {title.length > 0 && title.trim().length < 3 && (
              <p className="mt-1 text-2xs text-danger">Rubriken behöver minst 3 tecken.</p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Brödtext</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="Skriv informationen som ska nå målgruppen."
              className={TEXTAREA_CLS}
            />
            {body.length > 0 && body.trim().length < 10 && (
              <p className="mt-1 text-2xs text-danger">Brödtexten behöver minst 10 tecken.</p>
            )}
          </div>
        </div>
      )}

      {/* Steg 2: Målgrupp */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Målgrupp</label>
            <Select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
              {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((key) => (
                <option key={key} value={key}>
                  {AUDIENCE_LABEL[key]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-start gap-3 rounded-field border border-border bg-surface-2 p-3">
            <Badge tone={AUDIENCE_META[audience].tone} icon={AUDIENCE_META[audience].icon}>
              {AUDIENCE_LABEL[audience]}
            </Badge>
            <p className="text-sm text-ink-muted">{AUDIENCE_HINT[audience]}</p>
          </div>
        </div>
      )}

      {/* Steg 3: Publicering */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Markera som viktigt</label>
            <Segmented
              value={urgent ? 'ja' : 'nej'}
              onChange={(v) => setUrgent(v === 'ja')}
              options={[
                { value: 'nej', label: 'Nej' },
                { value: 'ja', label: 'Ja', icon: 'TriangleAlert' },
              ]}
            />
            <p className="mt-1 text-2xs text-ink-subtle">
              Viktiga anslag lyfts fram och notifieras med hög prioritet.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Kräver läsbekräftelse</label>
            <Segmented
              value={requireConfirm ? 'ja' : 'nej'}
              onChange={(v) => setRequireConfirm(v === 'ja')}
              options={[
                { value: 'nej', label: 'Nej' },
                { value: 'ja', label: 'Ja', icon: 'CheckCheck' },
              ]}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">Publicering</label>
            <Segmented
              value={publishMode}
              onChange={setPublishMode}
              options={[
                { value: 'nu', label: 'Publicera nu', icon: 'Send' },
                { value: 'senare', label: 'Schemalägg', icon: 'CalendarClock' },
              ]}
            />
          </div>
          {publishMode === 'senare' && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">Datum och tid</label>
              <TextInput
                type="datetime-local"
                icon="Calendar"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
              {scheduledAt !== '' && !scheduleValid && (
                <p className="mt-1 text-2xs text-danger">Tiden måste ligga framåt i tiden.</p>
              )}
            </div>
          )}
          <dl className="divide-y divide-border rounded-field border border-border">
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <dt className="text-ink-subtle">Rubrik</dt>
              <dd className="font-medium text-ink text-right truncate">{title.trim() || '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <dt className="text-ink-subtle">Målgrupp</dt>
              <dd className="font-medium text-ink text-right">{AUDIENCE_LABEL[audience]}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <dt className="text-ink-subtle">Publiceras</dt>
              <dd className="font-medium text-ink text-right">
                {publishMode === 'senare' && scheduledAt
                  ? fmtDateTime(new Date(scheduledAt))
                  : 'Direkt'}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </Modal>
  )
}
