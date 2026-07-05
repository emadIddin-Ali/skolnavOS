import { useEffect, useMemo, useReducer, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PageHeader, Card, CardHeader, CardBody, CardFooter, Button, Badge, StatusBadge,
  Segmented, Select, TextInput, Modal, Icon, DeniedState, toast,
} from '@/ui'
import { usePrincipal, usePermission, useCan } from '@/core/permissions/usePermission'
import { ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { useSession, type Theme } from '@/core/state/session'
import type { AppMode } from '@/core/domain/roles'
import { db, byId } from '@/data/db/store'
import type { NotificationChannel } from '@/data/schema'
import { cn } from '@/lib/cn'
import {
  CATEGORY_META, CATEGORY_ORDER, CHANNEL_META, type NotificationCategory,
} from '@/modules/notifications/meta'
import {
  PREF_CHANNELS, canManageSchoolSettings, getPreferenceDraft, recordMfaChange,
  savePreferences, toggleFeatureFlag, wait,
} from './service'

/** UI-utkast för notispreferenser (tyst läge som på/av + tider). */
interface PrefsDraft {
  channels: Record<NotificationCategory, NotificationChannel[]>
  quietEnabled: boolean
  quietStart: string
  quietEnd: string
}

function loadDraft(userId: string): PrefsDraft {
  const d = getPreferenceDraft(userId)
  return {
    channels: d.channels,
    quietEnabled: d.quietStart != null,
    quietStart: d.quietStart ?? '21:00',
    quietEnd: d.quietEnd ?? '07:00',
  }
}

export function SettingsPage() {
  const principal = usePrincipal()
  const navigate = useNavigate()
  const readDecision = usePermission('read', 'settings')
  const canOpenSecurity = useCan('read', 'security')

  const theme = useSession((s) => s.theme)
  const setTheme = useSession((s) => s.setTheme)
  const mode = useSession((s) => s.mode)
  const setMode = useSession((s) => s.setMode)
  const mfaSatisfied = useSession((s) => s.mfaSatisfied)
  const setMfa = useSession((s) => s.setMfa)
  const schoolId = useSession((s) => s.schoolId)

  const [refresh, bump] = useReducer((x: number) => x + 1, 0)
  const [draft, setDraft] = useState<PrefsDraft>(() => loadDraft(principal.userId))
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(loadDraft(principal.userId)))
  const [saving, setSaving] = useState(false)
  const [mfaModalOpen, setMfaModalOpen] = useState(false)
  const [mfaBusy, setMfaBusy] = useState(false)
  const [flagBusy, setFlagBusy] = useState(false)

  // Vid rollbyte: läs om preferenserna för den nya identiteten.
  useEffect(() => {
    setDraft(loadDraft(principal.userId))
    setSavedJson(JSON.stringify(loadDraft(principal.userId)))
  }, [principal.userId])

  const dirty = JSON.stringify(draft) !== savedJson
  const quietError =
    draft.quietEnabled && draft.quietStart === draft.quietEnd
      ? 'Start- och sluttid för tyst läge kan inte vara samma.'
      : null

  const school = byId(db.data.schools, schoolId)
  const isSchoolAdmin = canManageSchoolSettings(principal, schoolId)
  const swipeFlag = useMemo(() => {
    void refresh
    return db.data.featureFlags.find((f) => f.key === 'swipe_attendance')
  }, [refresh])

  function toggleChannel(cat: NotificationCategory, ch: NotificationChannel) {
    setDraft((prev) => {
      const has = prev.channels[cat].includes(ch)
      return {
        ...prev,
        channels: {
          ...prev.channels,
          [cat]: has ? prev.channels[cat].filter((c) => c !== ch) : [...prev.channels[cat], ch],
        },
      }
    })
  }

  async function handleSavePrefs() {
    if (!dirty || quietError) return
    setSaving(true)
    await wait(350)
    try {
      savePreferences(principal, {
        channels: draft.channels,
        quietStart: draft.quietEnabled ? draft.quietStart : null,
        quietEnd: draft.quietEnabled ? draft.quietEnd : null,
      })
      setSavedJson(JSON.stringify(draft))
      toast.success('Sparat', 'Dina notisinställningar har uppdaterats.')
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else if (e instanceof RateLimitedError) toast.warning('Tillfälligt begränsad', e.message)
      else toast.error('Något gick fel', 'Inställningarna kunde inte sparas just nu.')
    } finally {
      setSaving(false)
    }
  }

  async function handleMfaConfirm() {
    setMfaBusy(true)
    await wait(600)
    try {
      recordMfaChange(principal, !mfaSatisfied)
      setMfa(!mfaSatisfied)
      if (mfaSatisfied) {
        toast.info('Verifiering återställd', 'Administrativa åtgärder kräver nu ny MFA-verifiering.')
      } else {
        toast.success('MFA verifierad', 'Sessionen är verifierad med tvåfaktorsautentisering.')
      }
      setMfaModalOpen(false)
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Något gick fel', 'MFA-läget kunde inte ändras just nu.')
    } finally {
      setMfaBusy(false)
    }
  }

  async function handleToggleFlag() {
    setFlagBusy(true)
    await wait(300)
    try {
      const flag = toggleFeatureFlag(principal, 'swipe_attendance', schoolId)
      bump()
      toast.success(
        flag.enabled ? 'Svep-närvaro aktiverad' : 'Svep-närvaro avstängd',
        `Gäller ${school?.name ?? 'skolan'}. Ändringen har loggats.`,
      )
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Något gick fel', 'Funktionen kunde inte ändras just nu.')
    } finally {
      setFlagBusy(false)
    }
  }

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Inställningar" icon="Settings" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Inställningar"
        icon="Settings"
        subtitle="Utseende, notiser, språk och säkerhet för ditt konto."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Utseende */}
        <Card>
          <CardHeader
            icon="Sun"
            title="Utseende"
            subtitle="Tema och läge sparas för din session."
          />
          <CardBody className="space-y-5">
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">Tema</p>
              <Segmented<Theme>
                value={theme}
                onChange={setTheme}
                options={[
                  { value: 'light', label: 'Ljust', icon: 'Sun' },
                  { value: 'dark', label: 'Mörkt', icon: 'Moon' },
                ]}
              />
              <p className="mt-1.5 text-2xs text-ink-subtle">Byter färgschema direkt i hela systemet.</p>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">Läge</p>
              <Segmented<AppMode>
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'grundskola', label: 'Grundskola', icon: 'Backpack' },
                  { value: 'gymnasium', label: 'Gymnasium', icon: 'GraduationCap' },
                  { value: 'admin', label: 'Administration', icon: 'Settings2' },
                ]}
              />
              <p className="mt-1.5 text-2xs text-ink-subtle">
                Läget anpassar ton och innehåll efter verksamheten.
              </p>
            </div>
          </CardBody>
        </Card>

        {/* Språk */}
        <Card>
          <CardHeader
            icon="Globe"
            title="Språk"
            subtitle="Systemets språk för menyer och meddelanden."
            action={<Badge tone="info" icon="Sparkles">Fler språk kommande</Badge>}
          />
          <CardBody>
            <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="settings-language">
              Systemspråk
            </label>
            <Select
              id="settings-language"
              value="sv"
              disabled
              title="Fler språk är under utveckling – svenska är för närvarande enda alternativet."
              onChange={() => undefined}
            >
              <option value="sv">Svenska</option>
            </Select>
            <p className="mt-1.5 text-2xs text-ink-subtle">
              Engelska och arabiska planeras till kommande läsår.
            </p>
          </CardBody>
        </Card>

        {/* Notiser */}
        <Card className="lg:col-span-2">
          <CardHeader
            icon="Bell"
            title="Notiser"
            subtitle="Välj kanal per kategori. Känsligt innehåll maskeras alltid i push och e-post."
          />
          <CardBody className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-2xs uppercase tracking-wide text-ink-subtle">
                    <th className="py-2 pr-3 font-medium">Kategori</th>
                    {PREF_CHANNELS.map((ch) => (
                      <th key={ch} className="px-3 py-2 text-center font-medium">
                        <span className="inline-flex items-center gap-1">
                          <Icon name={CHANNEL_META[ch].icon} className="h-3.5 w-3.5" />
                          {CHANNEL_META[ch].label}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {CATEGORY_ORDER.map((cat) => (
                    <tr key={cat}>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <Icon name={CATEGORY_META[cat].icon} className="h-4 w-4 shrink-0 text-ink-subtle" />
                          <span className="font-medium text-ink">{CATEGORY_META[cat].label}</span>
                        </div>
                      </td>
                      {PREF_CHANNELS.map((ch) => (
                        <td key={ch} className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-primary"
                            checked={draft.channels[cat].includes(ch)}
                            onChange={() => toggleChannel(cat, ch)}
                            aria-label={`${CATEGORY_META[cat].label} via ${CHANNEL_META[ch].label}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-field border border-border bg-surface-2 p-4">
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={draft.quietEnabled}
                  onChange={(e) => setDraft((prev) => ({ ...prev, quietEnabled: e.target.checked }))}
                />
                <span>
                  <span className="block text-sm font-medium text-ink">Tyst läge</span>
                  <span className="block text-2xs text-ink-subtle">
                    Push och e-post pausas under valda timmar. Viktiga säkerhetsnotiser levereras alltid.
                  </span>
                </span>
              </label>
              <div className={cn('mt-3 grid max-w-sm grid-cols-2 gap-3', !draft.quietEnabled && 'opacity-50')}>
                <div>
                  <label className="mb-1 block text-2xs font-medium text-ink-muted" htmlFor="quiet-start">
                    Från
                  </label>
                  <TextInput
                    id="quiet-start"
                    type="time"
                    value={draft.quietStart}
                    disabled={!draft.quietEnabled}
                    onChange={(e) => setDraft((prev) => ({ ...prev, quietStart: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-2xs font-medium text-ink-muted" htmlFor="quiet-end">
                    Till
                  </label>
                  <TextInput
                    id="quiet-end"
                    type="time"
                    value={draft.quietEnd}
                    disabled={!draft.quietEnabled}
                    onChange={(e) => setDraft((prev) => ({ ...prev, quietEnd: e.target.value }))}
                  />
                </div>
              </div>
              {quietError && <p className="mt-2 text-2xs text-danger">{quietError}</p>}
            </div>
          </CardBody>
          <CardFooter className="justify-between">
            <p className="text-2xs text-ink-subtle">Gäller ditt konto på alla enheter.</p>
            <Button
              icon="Save"
              loading={saving}
              disabled={!dirty || !!quietError}
              title={
                quietError ?? (!dirty ? 'Inga ändringar att spara' : undefined)
              }
              onClick={handleSavePrefs}
            >
              Spara
            </Button>
          </CardFooter>
        </Card>

        {/* Säkerhet */}
        <Card>
          <CardHeader
            icon="Lock"
            title="Säkerhet"
            subtitle="Stark autentisering och säkerhetsöversikt."
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-border p-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Tvåfaktorsautentisering (MFA)</p>
                <p className="mt-0.5 text-2xs text-ink-subtle">
                  Krävs för administrativa åtgärder i känsliga moduler.
                </p>
                <div className="mt-2">
                  {mfaSatisfied ? (
                    <StatusBadge tone="success" icon="ShieldCheck" label="Verifierad i sessionen" />
                  ) : (
                    <StatusBadge tone="warning" icon="ShieldAlert" label="Ej verifierad" />
                  )}
                </div>
              </div>
              <Button
                variant="secondary"
                icon={mfaSatisfied ? 'ShieldOff' : 'Fingerprint'}
                onClick={() => setMfaModalOpen(true)}
              >
                {mfaSatisfied ? 'Kräv ny verifiering' : 'Verifiera nu'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-border p-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Säkerhetsöversikt</p>
                <p className="mt-0.5 text-2xs text-ink-subtle">
                  Inloggningar, händelser och aktiva skydd samlade på ett ställe.
                </p>
              </div>
              <Button
                variant="secondary"
                icon="Lock"
                disabled={!canOpenSecurity}
                title={!canOpenSecurity ? 'Din roll saknar behörighet till säkerhetsmodulen' : undefined}
                onClick={() => navigate('/sakerhet')}
              >
                Öppna Säkerhet
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Skolinställningar (endast skoladministration) */}
        {isSchoolAdmin && (
          <Card>
            <CardHeader
              icon="School"
              title="Skolinställningar"
              subtitle={school ? school.name : 'Aktuell skola'}
            />
            <CardBody>
              {swipeFlag ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-border p-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{swipeFlag.label}</p>
                    <p className="mt-0.5 text-2xs text-ink-subtle">
                      Personal registrerar närvaro med snabba svep i mobilen.
                    </p>
                    <div className="mt-2">
                      {swipeFlag.enabled ? (
                        <StatusBadge tone="success" icon="CircleCheck" label="Aktiv" />
                      ) : (
                        <StatusBadge tone="neutral" icon="CircleSlash" label="Avstängd" />
                      )}
                    </div>
                  </div>
                  <Button
                    variant={swipeFlag.enabled ? 'secondary' : 'primary'}
                    icon="Power"
                    loading={flagBusy}
                    onClick={handleToggleFlag}
                  >
                    {swipeFlag.enabled ? 'Stäng av' : 'Aktivera'}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">Inga skolinställningar tillgängliga.</p>
              )}
              <p className="mt-3 text-2xs text-ink-subtle">
                Ändringar gäller hela skolan och loggas i granskningsloggen.
              </p>
            </CardBody>
          </Card>
        )}
      </div>

      <Modal
        open={mfaModalOpen}
        onClose={() => setMfaModalOpen(false)}
        title={mfaSatisfied ? 'Kräv ny MFA-verifiering?' : 'Verifiera med MFA'}
        description={
          mfaSatisfied
            ? 'Sessionens verifiering återställs. Nästa administrativa åtgärd kräver ny tvåfaktorsverifiering.'
            : 'Bekräfta din identitet med tvåfaktorsautentisering (simulerad verifiering i demomiljön).'
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMfaModalOpen(false)} disabled={mfaBusy}>
              Avbryt
            </Button>
            <Button
              variant={mfaSatisfied ? 'danger' : 'primary'}
              icon={mfaSatisfied ? 'ShieldOff' : 'Fingerprint'}
              loading={mfaBusy}
              onClick={handleMfaConfirm}
            >
              {mfaSatisfied ? 'Återställ verifiering' : 'Verifiera'}
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-2 rounded-field border border-border bg-surface-2 px-3 py-2.5 text-sm text-ink-muted">
          <Icon name="Info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <span>
            {mfaSatisfied
              ? 'Detta påverkar bara din nuvarande session – inte kontots MFA-registrering.'
              : 'I produktion sker verifieringen med e-legitimation eller säkerhetsnyckel.'}
          </span>
        </div>
      </Modal>
    </>
  )
}
