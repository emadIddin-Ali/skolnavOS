import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useSession } from '@/core/state/session'
import {
  ROLES,
  ROLE_CATEGORY_LABEL,
  ROLE_KEYS,
  type RoleCategory,
  type RoleKey,
} from '@/core/domain/roles'
import { Badge, Button, Card, CardBody, Icon, Modal, Tabs, TextInput, toast } from '@/ui'
import { cn } from '@/lib/cn'
import {
  attemptEmailLogin,
  auditLogin,
  isLoginBlocked,
  requestMagicLink,
  requestPasswordReset,
  verifyMfaCode,
  wait,
  EMAIL_RE,
  LOCKOUT_MESSAGE,
  type LoginMethod,
} from './service'

type TabKey = 'epost' | 'demo'

interface FieldErrors {
  email?: string
  password?: string
}

/** Steg för stark autentisering (MFA) – används av både e-post- och demoflödet. */
function MfaStep({
  role,
  onVerified,
  onCancel,
}: {
  role: RoleKey
  onVerified: () => void
  onCancel: () => void
}) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const meta = ROLES[role]

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (verifying || code.length !== 6) return
    setVerifying(true)
    setError(null)
    await wait(500)
    if (verifyMfaCode(code)) {
      onVerified()
      return
    }
    setVerifying(false)
    setError('Fel kod. Kontrollera din autentiseringsapp och försök igen.')
  }

  return (
    <form onSubmit={handleVerify} className="space-y-4" noValidate>
      <div className="flex flex-col items-center text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-primary">
          <Icon name="ShieldCheck" className="h-6 w-6" />
        </span>
        <h2 className="mt-3 text-base font-semibold text-ink">Stark autentisering</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Rollen <span className="font-medium text-ink">{meta.label}</span> kräver
          tvåfaktorsautentisering. Ange den 6-siffriga koden från din autentiseringsapp.
        </p>
      </div>

      <div className="space-y-2">
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
            setError(null)
          }}
          placeholder="••••••"
          aria-label="Engångskod, 6 siffror"
          className={cn(
            'h-12 w-full rounded-field border bg-surface text-center text-xl font-semibold tracking-[0.4em] text-ink placeholder:text-ink-subtle',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary',
            error ? 'border-danger' : 'border-border',
          )}
        />
        {error && (
          <p className="text-center text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <p className="text-center text-xs text-ink-subtle">Demoläge: koden är 123456.</p>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          className="w-full justify-center"
          loading={verifying}
          disabled={code.length !== 6}
          title={code.length !== 6 ? 'Ange den 6-siffriga koden först' : undefined}
        >
          Verifiera och logga in
        </Button>
        <Button
          type="button"
          variant="ghost"
          icon="ArrowLeft"
          className="w-full justify-center"
          onClick={onCancel}
        >
          Tillbaka
        </Button>
      </div>
    </form>
  )
}

/** Liten modal för återställningslänk – avslöjar aldrig om kontot finns. */
function ForgotPasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function handleSend() {
    if (sending) return
    if (!EMAIL_RE.test(value.trim())) {
      setError('Ange en giltig e-postadress.')
      return
    }
    setError(null)
    setSending(true)
    await wait(600)
    const res = requestPasswordReset()
    setSending(false)
    if (!res.ok) {
      toast.warning('För många förfrågningar', res.message)
      return
    }
    toast.success('Om kontot finns skickas en länk inom kort.')
    setValue('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Glömt lösenord?"
      description="Ange din e-postadress så skickar vi en återställningslänk."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Avbryt
          </Button>
          <Button icon="Send" loading={sending} onClick={() => void handleSend()}>
            Skicka återställningslänk
          </Button>
        </>
      }
    >
      <div className="space-y-2 pb-2">
        <label htmlFor="reset-email" className="block text-sm font-medium text-ink">
          E-postadress
        </label>
        <TextInput
          id="reset-email"
          icon="Mail"
          type="email"
          autoComplete="email"
          placeholder="namn@skola.se"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleSend()
            }
          }}
        />
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        <p className="text-xs text-ink-subtle">
          Av säkerhetsskäl bekräftar vi aldrig om en adress finns registrerad.
        </p>
      </div>
    </Modal>
  )
}

export function LoginPage() {
  const authenticated = useSession((s) => s.authenticated)
  const login = useSession((s) => s.login)
  const setMfa = useSession((s) => s.setMfa)
  const navigate = useNavigate()

  const [tab, setTab] = useState<TabKey>('epost')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [locked, setLocked] = useState(() => isLoginBlocked())
  const [magicSending, setMagicSending] = useState(false)
  const [mfaPending, setMfaPending] = useState<{ role: RoleKey; method: LoginMethod } | null>(null)
  const [forgotOpen, setForgotOpen] = useState(false)

  const roleGroups = useMemo(
    () =>
      (Object.keys(ROLE_CATEGORY_LABEL) as RoleCategory[])
        .map((cat) => ({
          cat,
          label: ROLE_CATEGORY_LABEL[cat],
          roles: ROLE_KEYS.filter((k) => ROLES[k].category === cat),
        }))
        .filter((g) => g.roles.length > 0),
    [],
  )

  if (authenticated) return <Navigate to="/" replace />

  function finishLogin(role: RoleKey, method: LoginMethod, mfaUsed: boolean) {
    auditLogin(role, method, mfaUsed)
    login(role)
    if (mfaUsed) setMfa(true)
    toast.success(`Inloggad som ${ROLES[role].label}`, 'Välkommen till Skolnav OS.')
    navigate('/', { replace: true })
  }

  function validateForm(): FieldErrors {
    const errs: FieldErrors = {}
    const value = email.trim()
    if (!value) errs.email = 'Ange din e-postadress.'
    else if (!EMAIL_RE.test(value)) errs.email = 'Ange en giltig e-postadress.'
    if (!password) errs.password = 'Ange ditt lösenord.'
    // 'fel123' släpps förbi längdkravet för att demonstrera fel uppgifter.
    else if (password.length < 8 && password !== 'fel123')
      errs.password = 'Lösenordet måste vara minst 8 tecken.'
    return errs
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting || locked) return
    const errs = validateForm()
    setErrors(errs)
    if (errs.email || errs.password) return
    setSubmitting(true)
    setFormError(null)
    await wait(800)
    const res = attemptEmailLogin(email, password)
    if (!res.ok) {
      setSubmitting(false)
      if (res.lockedOut) {
        setLocked(true)
        setAttemptsLeft(null)
        setFormError(LOCKOUT_MESSAGE)
        toast.error('Inloggningen är tillfälligt spärrad', LOCKOUT_MESSAGE)
      } else {
        setFormError(res.error)
        setAttemptsLeft(res.remaining)
      }
      return
    }
    setAttemptsLeft(null)
    if (ROLES[res.role].requiresMfa) {
      setSubmitting(false)
      setMfaPending({ role: res.role, method: 'losenord' })
    } else {
      finishLogin(res.role, 'losenord', false)
    }
  }

  async function handleMagicLink() {
    if (magicSending) return
    if (!EMAIL_RE.test(email.trim())) {
      setErrors((prev) => ({ ...prev, email: 'Ange din e-postadress ovan för att få en länk.' }))
      return
    }
    setMagicSending(true)
    await wait(500)
    const res = requestMagicLink()
    setMagicSending(false)
    if (res.ok) toast.info('Länk skickad om kontot finns.', 'Kontrollera din inkorg och skräppost.')
    else toast.warning('För många förfrågningar', res.message)
  }

  function handleDemoLogin(role: RoleKey) {
    if (ROLES[role].requiresMfa) setMfaPending({ role, method: 'demokonto' })
    else finishLogin(role, 'demokonto', false)
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        {/* Logotyp */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex items-center gap-2.5">
            <span className="grid h-11 w-11 place-items-center rounded-panel bg-primary text-primary-fg shadow-card">
              <Icon name="Hexagon" className="h-6 w-6" />
            </span>
            <span className="text-2xl font-semibold tracking-tight text-ink">Skolnav OS</span>
          </div>
          <p className="mt-2 text-sm text-ink-muted">Ett samlat skoloperativsystem</p>
        </div>

        <Card>
          <CardBody className="px-5 pt-5 pb-6 sm:px-6">
            {mfaPending ? (
              <MfaStep
                role={mfaPending.role}
                onVerified={() => finishLogin(mfaPending.role, mfaPending.method, true)}
                onCancel={() => setMfaPending(null)}
              />
            ) : (
              <>
                <Tabs<TabKey>
                  tabs={[
                    { value: 'epost', label: 'E-post', icon: 'Mail' },
                    { value: 'demo', label: 'Demokonton', icon: 'Users' },
                  ]}
                  value={tab}
                  onChange={setTab}
                  className="mb-5"
                />

                {tab === 'epost' ? (
                  <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
                    <div className="space-y-1.5">
                      <label htmlFor="login-email" className="block text-sm font-medium text-ink">
                        E-postadress
                      </label>
                      <TextInput
                        id="login-email"
                        icon="Mail"
                        type="email"
                        autoComplete="email"
                        placeholder="namn@skola.se"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value)
                          setErrors((prev) => ({ ...prev, email: undefined }))
                        }}
                        aria-invalid={errors.email ? true : undefined}
                      />
                      {errors.email && (
                        <p className="text-xs text-danger" role="alert">
                          {errors.email}
                        </p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label htmlFor="login-password" className="block text-sm font-medium text-ink">
                          Lösenord
                        </label>
                        <button
                          type="button"
                          onClick={() => setForgotOpen(true)}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Glömt lösenord?
                        </button>
                      </div>
                      <TextInput
                        id="login-password"
                        icon="Lock"
                        type="password"
                        autoComplete="current-password"
                        placeholder="Minst 8 tecken"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value)
                          setErrors((prev) => ({ ...prev, password: undefined }))
                        }}
                        aria-invalid={errors.password ? true : undefined}
                      />
                      {errors.password && (
                        <p className="text-xs text-danger" role="alert">
                          {errors.password}
                        </p>
                      )}
                    </div>

                    {formError && (
                      <div
                        className="flex items-start gap-2 rounded-field bg-danger-soft px-3 py-2.5 text-sm text-danger"
                        role="alert"
                      >
                        <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          {formError}
                          {!locked && attemptsLeft != null && attemptsLeft <= 2 && (
                            <span className="block text-xs opacity-80">
                              {attemptsLeft === 0
                                ? 'Nästa misslyckade försök spärrar inloggningen tillfälligt.'
                                : `${attemptsLeft} försök kvar innan tillfällig spärr.`}
                            </span>
                          )}
                        </span>
                      </div>
                    )}

                    <Button
                      type="submit"
                      icon="LogIn"
                      className="w-full justify-center"
                      loading={submitting}
                      disabled={locked}
                      title={locked ? LOCKOUT_MESSAGE : undefined}
                    >
                      {submitting ? 'Loggar in …' : 'Logga in'}
                    </Button>

                    <div className="flex items-center gap-3 pt-1" aria-hidden>
                      <span className="h-px flex-1 bg-border" />
                      <span className="text-xs text-ink-subtle">eller fortsätt med</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Button
                        type="button"
                        variant="secondary"
                        icon="Sparkles"
                        loading={magicSending}
                        onClick={() => void handleMagicLink()}
                        className="justify-center"
                      >
                        Magisk länk
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        icon="Fingerprint"
                        disabled
                        title="Kräver avtal med huvudmannen – kontakta er administratör."
                        className="justify-center"
                      >
                        E-legitimation
                        <Badge tone="neutral" className="ml-1">
                          Kräver avtal
                        </Badge>
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="max-h-[24rem] space-y-4 overflow-y-auto pr-1">
                    {roleGroups.map((group) => (
                      <div key={group.cat}>
                        <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">
                          {group.label}
                        </h3>
                        <div className="space-y-1.5">
                          {group.roles.map((k) => {
                            const meta = ROLES[k]
                            return (
                              <button
                                key={k}
                                type="button"
                                onClick={() => handleDemoLogin(k)}
                                className="flex w-full items-center gap-3 rounded-field border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                              >
                                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-field bg-primary-soft text-primary">
                                  <Icon name={meta.icon} className="h-4 w-4" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                                    {meta.label}
                                    {meta.requiresMfa && (
                                      <Badge tone="info" icon="ShieldCheck">
                                        MFA
                                      </Badge>
                                    )}
                                  </span>
                                  <span className="mt-0.5 block text-xs text-ink-muted">
                                    {meta.description}
                                  </span>
                                </span>
                                <Icon
                                  name="ChevronRight"
                                  className="h-4 w-4 shrink-0 text-ink-subtle"
                                />
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardBody>
        </Card>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-ink-subtle">
          <Icon name="ShieldCheck" className="h-3.5 w-3.5" />
          Skyddad av stark autentisering · GDPR-säkrad
        </p>
      </div>

      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </div>
  )
}
