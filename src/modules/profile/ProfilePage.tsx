import { useMemo, useReducer, useState } from 'react'
import {
  PageHeader, Card, CardHeader, CardBody, CardFooter, Button, Badge, StatusBadge,
  Avatar, Modal, TextInput, Icon, DeniedState, EmptyState, toast,
} from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { useSession } from '@/core/state/session'
import { ROLES } from '@/core/domain/roles'
import { db } from '@/data/db/store'
import type { User } from '@/data/schema'
import { fmtRelative, maskName } from '@/lib/format'
import {
  changePassword, endSession, listSessions, updateContact, wait, type DeviceSession,
} from './service'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[+0-9][0-9 ()-]{5,}$/

export function ProfilePage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'settings', { ownerUserId: principal.userId })
  const mfaSatisfied = useSession((s) => s.mfaSatisfied)
  const restartTour = useSession((s) => s.restartTour)

  const [refresh, bump] = useReducer((x: number) => x + 1, 0)
  const [contactOpen, setContactOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [endingId, setEndingId] = useState<string | null>(null)

  const user = useMemo(() => {
    void refresh
    return db.data.users.find((u) => u.id === principal.userId)
  }, [principal, refresh])

  const sessions = useMemo(() => {
    void refresh
    return listSessions(principal.userId)
  }, [principal, refresh])

  const schoolNames = useMemo(
    () =>
      principal.schoolIds
        .map((id) => db.data.schools.find((s) => s.id === id)?.name)
        .filter((n): n is string => Boolean(n)),
    [principal],
  )

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Min profil" icon="User" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  if (!user) {
    return (
      <>
        <PageHeader title="Min profil" icon="User" />
        <Card>
          <EmptyState
            icon="UserX"
            title="Profilen kunde inte hittas"
            description="Ditt konto saknar en användarpost. Kontakta administratör."
          />
        </Card>
      </>
    )
  }

  const masked = user.protectedIdentity && !principal.protectedClearance
  const displayName = masked ? maskName(user.name) : user.name
  const role = ROLES[principal.role]

  function endDeviceSession(s: DeviceSession) {
    setEndingId(s.id)
    try {
      endSession(principal, s.id)
      bump()
      toast.success('Sessionen avslutad', `${s.device} har loggats ut.`)
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Något gick fel', e instanceof Error ? e.message : 'Försök igen om en stund.')
    } finally {
      setEndingId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Min profil"
        icon="User"
        subtitle="Dina uppgifter, inloggningssäkerhet och aktiva sessioner."
        actions={
          <Button
            variant="secondary"
            icon="Compass"
            onClick={() => {
              restartTour()
              toast.info('Guidad tur startas om', 'Turen visas igen för aktuell vy.')
            }}
          >
            Starta guidad tur
          </Button>
        }
      />

      {masked && (
        <div className="mb-5 flex items-start gap-2 rounded-field border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          <Icon name="ShieldAlert" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Skyddad identitet – uppgifterna visas maskerade.</span>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Profilkort */}
        <Card>
          <CardBody className="pt-5">
            <div className="flex items-center gap-4">
              <Avatar name={displayName} color={user.avatarColor} size="lg" protected={masked} />
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-ink">{displayName}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone="primary" icon={role.icon}>{role.label}</Badge>
                  {mfaSatisfied ? (
                    <Badge tone="success" icon="ShieldCheck">MFA verifierad</Badge>
                  ) : (
                    <Badge tone="warning" icon="ShieldAlert">MFA ej verifierad</Badge>
                  )}
                </div>
              </div>
            </div>

            <dl className="mt-5 divide-y divide-border rounded-field border border-border">
              <ProfileRow icon="Mail" label="E-post" value={user.email} />
              <ProfileRow icon="Phone" label="Telefon" value={user.phone ?? 'Ej angivet'} />
              <ProfileRow
                icon="School"
                label={schoolNames.length === 1 ? 'Skola' : 'Skolor'}
                value={
                  schoolNames.length === 0
                    ? 'Hela organisationen'
                    : schoolNames.length > 2
                      ? `${schoolNames.slice(0, 2).join(', ')} +${schoolNames.length - 2} till`
                      : schoolNames.join(', ')
                }
              />
              <ProfileRow
                icon="History"
                label="Senaste inloggning"
                value={user.lastLoginAt ? fmtRelative(user.lastLoginAt) : '—'}
              />
            </dl>
          </CardBody>
          <CardFooter>
            <Button variant="secondary" icon="PencilLine" onClick={() => setContactOpen(true)}>
              Redigera kontaktuppgifter
            </Button>
          </CardFooter>
        </Card>

        <div className="space-y-5">
          {/* Konto & säkerhet */}
          <Card>
            <CardHeader
              icon="KeyRound"
              title="Konto & säkerhet"
              subtitle="Lösenord och inloggningsskydd för ditt konto."
            />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-border p-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">Lösenord</p>
                  <p className="mt-0.5 text-2xs text-ink-subtle">
                    Använd minst 8 tecken. Byt direkt om du misstänker intrång.
                  </p>
                </div>
                <Button variant="secondary" icon="KeyRound" onClick={() => setPasswordOpen(true)}>
                  Byt lösenord
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-border p-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">Tvåfaktorsautentisering</p>
                  <p className="mt-0.5 text-2xs text-ink-subtle">
                    Hanteras under Inställningar → Säkerhet.
                  </p>
                </div>
                {mfaSatisfied ? (
                  <StatusBadge tone="success" icon="ShieldCheck" label="Verifierad" />
                ) : (
                  <StatusBadge tone="warning" icon="ShieldAlert" label="Ej verifierad" />
                )}
              </div>
            </CardBody>
          </Card>

          {/* Sessioner */}
          <Card>
            <CardHeader
              icon="MonitorSmartphone"
              title="Mina sessioner"
              subtitle="Enheter som är inloggade på ditt konto just nu."
            />
            <CardBody className="pt-0">
              {sessions.length === 0 ? (
                <EmptyState
                  icon="MonitorCheck"
                  title="Inga aktiva sessioner"
                  description="Du är inte inloggad på någon annan enhet."
                />
              ) : (
                <ul className="divide-y divide-border rounded-field border border-border">
                  {sessions.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-field bg-surface-2 text-ink-muted">
                        <Icon name={s.icon} className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-medium text-ink">{s.device}</p>
                          {s.current && <Badge tone="primary" dot>Den här enheten</Badge>}
                        </div>
                        <p className="text-2xs text-ink-subtle">
                          {s.location} · Senast aktiv {fmtRelative(s.lastActiveAt)}
                        </p>
                      </div>
                      {s.current ? (
                        <span className="text-2xs text-ink-subtle" title="Den aktiva sessionen avslutas genom att logga ut.">
                          Aktiv nu
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon="LogOut"
                          loading={endingId === s.id}
                          disabled={endingId !== null}
                          onClick={() => endDeviceSession(s)}
                        >
                          Avsluta
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {contactOpen && (
        <ContactModal
          user={user}
          onClose={() => setContactOpen(false)}
          onSaved={() => {
            bump()
            setContactOpen(false)
          }}
        />
      )}

      {passwordOpen && <PasswordModal onClose={() => setPasswordOpen(false)} />}
    </>
  )
}

function ProfileRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <Icon name={icon} className="h-4 w-4 shrink-0 text-ink-subtle" />
      <dt className="w-32 shrink-0 text-sm text-ink-subtle">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-right text-sm font-medium text-ink" title={value}>
        {value}
      </dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Redigera kontaktuppgifter
// ---------------------------------------------------------------------------

function ContactModal({
  user,
  onClose,
  onSaved,
}: {
  user: User
  onClose: () => void
  onSaved: () => void
}) {
  const principal = usePrincipal()
  const [email, setEmail] = useState(user.email)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; phone?: string }>({})

  function validate(): boolean {
    const next: { email?: string; phone?: string } = {}
    if (!email.trim()) next.email = 'E-postadress är obligatorisk.'
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Ange en giltig e-postadress.'
    if (phone.trim() && !PHONE_RE.test(phone.trim())) next.phone = 'Ange ett giltigt telefonnummer.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit() {
    if (!validate()) return
    setSaving(true)
    await wait(300)
    try {
      updateContact(principal, { email, phone })
      toast.success('Kontaktuppgifter sparade')
      onSaved()
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else if (e instanceof RateLimitedError) toast.warning('Tillfälligt begränsad', e.message)
      else toast.error('Något gick fel', 'Uppgifterna kunde inte sparas just nu.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Redigera kontaktuppgifter"
      description="Uppgifterna används för avisering och kontakt från skolan."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Avbryt
          </Button>
          <Button icon="Save" loading={saving} onClick={submit}>
            Spara
          </Button>
        </>
      }
    >
      <div className="space-y-4 py-1">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="profile-email">
            E-post <span className="text-danger">*</span>
          </label>
          <TextInput
            id="profile-email"
            type="email"
            icon="Mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="namn@exempel.se"
          />
          {errors.email && <p className="mt-1 text-2xs text-danger">{errors.email}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="profile-phone">
            Telefon <span className="text-ink-subtle">(valfritt)</span>
          </label>
          <TextInput
            id="profile-phone"
            type="tel"
            icon="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="070-123 45 67"
          />
          {errors.phone && <p className="mt-1 text-2xs text-danger">{errors.phone}</p>}
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Byt lösenord (simulerat)
// ---------------------------------------------------------------------------

function PasswordModal({ onClose }: { onClose: () => void }) {
  const principal = usePrincipal()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ current?: string; next?: string; repeat?: string }>({})

  function validate(): boolean {
    const e: { current?: string; next?: string; repeat?: string } = {}
    if (!current) e.current = 'Ange ditt nuvarande lösenord.'
    if (next.length < 8) e.next = 'Det nya lösenordet måste vara minst 8 tecken.'
    else if (next === current) e.next = 'Det nya lösenordet måste skilja sig från det nuvarande.'
    if (repeat !== next) e.repeat = 'Lösenorden matchar inte.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit() {
    if (!validate()) return
    setSaving(true)
    await wait(400)
    try {
      changePassword(principal)
      toast.success('Lösenordet är bytt', 'Använd det nya lösenordet vid nästa inloggning.')
      onClose()
    } catch (e) {
      if (e instanceof RateLimitedError) toast.warning('För många försök', e.message)
      else if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Något gick fel', 'Lösenordet kunde inte bytas just nu.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Byt lösenord"
      description="Minst 8 tecken. Undvik lösenord du använder på andra tjänster."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Avbryt
          </Button>
          <Button icon="KeyRound" loading={saving} onClick={submit}>
            Byt lösenord
          </Button>
        </>
      }
    >
      <div className="space-y-4 py-1">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="pw-current">
            Nuvarande lösenord
          </label>
          <TextInput
            id="pw-current"
            type="password"
            icon="Lock"
            value={current}
            autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)}
          />
          {errors.current && <p className="mt-1 text-2xs text-danger">{errors.current}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="pw-next">
            Nytt lösenord
          </label>
          <TextInput
            id="pw-next"
            type="password"
            icon="KeyRound"
            value={next}
            autoComplete="new-password"
            onChange={(e) => setNext(e.target.value)}
          />
          {errors.next && <p className="mt-1 text-2xs text-danger">{errors.next}</p>}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="pw-repeat">
            Upprepa nytt lösenord
          </label>
          <TextInput
            id="pw-repeat"
            type="password"
            icon="KeyRound"
            value={repeat}
            autoComplete="new-password"
            onChange={(e) => setRepeat(e.target.value)}
          />
          {errors.repeat && <p className="mt-1 text-2xs text-danger">{errors.repeat}</p>}
        </div>
      </div>
    </Modal>
  )
}
