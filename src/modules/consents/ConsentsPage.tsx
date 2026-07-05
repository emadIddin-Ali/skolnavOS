import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, Card, CardHeader, CardBody, DataTable, Tabs, Button, Badge, StatusBadge,
  Avatar, Modal, TextInput, Select, Segmented, ProgressBar, Icon,
  EmptyState, DeniedState, LoadingRows, toast,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db } from '@/data/db/store'
import type { ConsentRequest, ConsentResponse, Student } from '@/data/schema'
import { fmtDate, fmtDateTime, maskName } from '@/lib/format'
import { cn } from '@/lib/cn'
import {
  CONSENT_STATUS_LABEL, CONSENT_METHOD_LABEL, CONSENT_DECISION_LABEL,
  createConsentRequests, signConsent,
} from './service'

// ---- Presentationskartor ----
const STATUS_META: Record<ConsentRequest['status'], { tone: Tone; icon: string }> = {
  utkast: { tone: 'neutral', icon: 'PenLine' },
  utskickad: { tone: 'info', icon: 'Send' },
  delvis: { tone: 'warning', icon: 'Clock' },
  signerad: { tone: 'success', icon: 'CircleCheck' },
  avböjd: { tone: 'danger', icon: 'CircleX' },
  utgången: { tone: 'neutral', icon: 'Ban' },
}

const METHOD_META: Record<ConsentResponse['method'], { tone: Tone; icon: string }> = {
  app: { tone: 'primary', icon: 'Smartphone' },
  'e-legitimation': { tone: 'success', icon: 'Fingerprint' },
  manuell: { tone: 'neutral', icon: 'PenLine' },
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Dagar kvar till förfallodag (negativt = passerad). */
function daysLeft(dueAt: string): number {
  return Math.floor((new Date(dueAt).getTime() - Date.now()) / 86_400_000)
}

function DueLabel({ dueAt }: { dueAt: string }) {
  const left = daysLeft(dueAt)
  const urgent = left <= 3
  return (
    <div className={cn('whitespace-nowrap', urgent ? 'font-medium text-danger' : 'text-ink-muted')}>
      <div>{fmtDate(dueAt)}</div>
      <div className="text-2xs">
        {left < 0 ? 'Förfallet' : left === 0 ? 'Förfaller idag' : `${left} dagar kvar`}
      </div>
    </div>
  )
}

interface RequestRow {
  id: string
  request: ConsentRequest
  student?: Student
  masked: boolean
  studentLabel: string
}

export function ConsentsPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'consent')
  const canCreate = usePermission('create', 'consent').allowed
  const isGuardian = principal.role === 'vardnadshavare'

  const [loading, setLoading] = useState(true)
  const [refresh, bump] = useReducer((x) => x + 1, 0)
  const [tab, setTab] = useState<'aktuella' | 'historik'>('aktuella')
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    wait(220).then(() => {
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  // Behörighetsfiltrerade förfrågningar.
  const rows = useMemo<RequestRow[]>(() => {
    void refresh
    return db.data.consentRequests
      .map<RequestRow | null>((request) => {
        const student = db.data.students.find((s) => s.id === request.studentId)
        const decision = can(principal, 'read', 'consent', {
          organizationId: request.organizationId,
          schoolId: request.schoolId,
          classId: student?.classId,
          studentId: request.studentId,
          protectedIdentity: student?.protectedIdentity,
        })
        if (!decision.allowed) return null
        if (isGuardian && !principal.guardianStudentIds.includes(request.studentId)) return null
        const fullName = student ? `${student.firstName} ${student.lastName}` : 'Okänd elev'
        const masked = Boolean(decision.masked)
        return {
          id: request.id,
          request,
          student,
          masked,
          studentLabel: masked ? maskName(fullName) : fullName,
        }
      })
      .filter((r): r is RequestRow => r !== null)
      .sort((a, b) => new Date(a.request.dueAt).getTime() - new Date(b.request.dueAt).getTime())
  }, [principal, refresh, isGuardian])

  // Vårdnadshavare: väntande samtycken per barn.
  const pendingByChild = useMemo(() => {
    if (!isGuardian) return []
    const done: ConsentRequest['status'][] = ['signerad', 'avböjd', 'utgången', 'utkast']
    return principal.guardianStudentIds
      .map((sid) => {
        const student = db.data.students.find((s) => s.id === sid)
        const pending = rows.filter(
          (r) =>
            r.request.studentId === sid &&
            !done.includes(r.request.status) &&
            !db.data.consentResponses.some(
              (resp) => resp.requestId === r.request.id && resp.guardianUserId === principal.userId,
            ),
        )
        return { student, pending }
      })
      .filter((g): g is { student: Student; pending: RequestRow[] } => Boolean(g.student))
  }, [isGuardian, principal, rows])

  const pendingCount = pendingByChild.reduce((acc, g) => acc + g.pending.length, 0)

  // Signeringshistorik: svar joinade mot förfrågningar i räckvidden.
  const historyRows = useMemo(() => {
    void refresh
    const readableRequests = new Map(rows.map((r) => [r.request.id, r]))
    return db.data.consentResponses
      .filter((resp) =>
        isGuardian ? resp.guardianUserId === principal.userId : readableRequests.has(resp.requestId),
      )
      .map((resp) => {
        const row = readableRequests.get(resp.requestId)
        const guardian = db.data.users.find((u) => u.id === resp.guardianUserId)
        return {
          id: resp.id,
          response: resp,
          request: row?.request,
          studentLabel: row?.studentLabel ?? 'Okänd elev',
          guardianLabel:
            resp.guardianUserId === principal.userId ? 'Du' : guardian?.name ?? 'Vårdnadshavare',
        }
      })
      .filter((h) => h.request)
      .sort(
        (a, b) =>
          new Date(b.response.signedAt ?? 0).getTime() - new Date(a.response.signedAt ?? 0).getTime(),
      )
  }, [rows, isGuardian, principal, refresh])

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Samtycken" icon="ClipboardCheck" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const requestColumns: Column<RequestRow>[] = [
    {
      key: 'title',
      header: 'Titel',
      render: (r) => (
        <div className="min-w-0 max-w-[220px]">
          <div className="font-medium text-ink truncate">{r.request.title}</div>
          {r.request.requiredCount > 1 && (
            <div className="text-2xs text-ink-subtle">Kräver båda vårdnadshavarna</div>
          )}
        </div>
      ),
    },
    {
      key: 'student',
      header: 'Elev',
      render: (r) => (
        <div className="flex items-center gap-2">
          <Avatar name={r.studentLabel} color={r.student?.photoColor} size="sm" protected={r.masked} />
          <span className="text-ink truncate">{r.studentLabel}</span>
          {r.masked && (
            <span title="Skyddad identitet – maskerad">
              <Icon name="ShieldAlert" className="h-3.5 w-3.5 text-warning" />
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <StatusBadge
          tone={STATUS_META[r.request.status].tone}
          icon={STATUS_META[r.request.status].icon}
          label={CONSENT_STATUS_LABEL[r.request.status]}
        />
      ),
    },
    {
      key: 'progress',
      header: 'Svar',
      hideOnMobile: true,
      render: (r) => (
        <div className="min-w-[120px] max-w-[160px]">
          <ProgressBar
            value={(r.request.respondedCount / Math.max(1, r.request.requiredCount)) * 100}
            tone={r.request.status === 'avböjd' ? 'danger' : r.request.respondedCount >= r.request.requiredCount ? 'success' : 'primary'}
          />
          <div className="mt-0.5 text-2xs tabular-nums text-ink-subtle">
            {r.request.respondedCount} av {r.request.requiredCount} svar
          </div>
        </div>
      ),
    },
    {
      key: 'due',
      header: 'Förfaller',
      hideOnMobile: true,
      render: (r) => <DueLabel dueAt={r.request.dueAt} />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Samtycken"
        icon="ClipboardCheck"
        subtitle={
          isGuardian
            ? 'Signera väntande samtycken för dina barn.'
            : 'Skicka ut, följ upp och dokumentera vårdnadshavarnas samtycken.'
        }
        actions={
          !isGuardian && canCreate ? (
            <Button icon="Plus" onClick={() => setCreateOpen(true)}>
              Nytt samtycke
            </Button>
          ) : undefined
        }
      />

      <Card>
        <div className="px-2 pt-1 sm:px-4">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              {
                value: 'aktuella' as const,
                label: isGuardian ? 'Att signera' : 'Förfrågningar',
                icon: isGuardian ? 'PenLine' : 'Send',
                count: isGuardian ? pendingCount : rows.length,
              },
              {
                value: 'historik' as const,
                label: 'Signeringshistorik',
                icon: 'History',
                count: historyRows.length,
              },
            ]}
          />
        </div>

        {loading ? (
          <LoadingRows rows={6} />
        ) : tab === 'historik' ? (
          historyRows.length === 0 ? (
            <EmptyState
              icon="History"
              title="Ingen signeringshistorik än"
              description="När samtycken besvaras visas signaturerna här."
            />
          ) : (
            <DataTable
              caption="Signeringshistorik"
              rows={historyRows}
              columns={[
                {
                  key: 'who',
                  header: 'Vem',
                  render: (h) => <span className="font-medium text-ink">{h.guardianLabel}</span>,
                },
                {
                  key: 'what',
                  header: 'Samtycke',
                  render: (h) => (
                    <div className="min-w-0 max-w-[240px]">
                      <div className="text-ink truncate">{h.request?.title}</div>
                      <div className="text-2xs text-ink-subtle truncate">{h.studentLabel}</div>
                    </div>
                  ),
                },
                {
                  key: 'decision',
                  header: 'Beslut',
                  render: (h) => (
                    <StatusBadge
                      tone={h.response.decision === 'godkänt' ? 'success' : h.response.decision === 'avböjt' ? 'danger' : 'neutral'}
                      icon={h.response.decision === 'godkänt' ? 'CircleCheck' : h.response.decision === 'avböjt' ? 'CircleX' : 'Clock'}
                      label={CONSENT_DECISION_LABEL[h.response.decision]}
                    />
                  ),
                },
                {
                  key: 'method',
                  header: 'Metod',
                  hideOnMobile: true,
                  render: (h) => (
                    <Badge tone={METHOD_META[h.response.method].tone} icon={METHOD_META[h.response.method].icon}>
                      {CONSENT_METHOD_LABEL[h.response.method]}
                    </Badge>
                  ),
                },
                {
                  key: 'when',
                  header: 'När',
                  hideOnMobile: true,
                  render: (h) => (
                    <span className="text-ink-muted whitespace-nowrap">
                      {h.response.signedAt ? fmtDateTime(h.response.signedAt) : '—'}
                    </span>
                  ),
                },
              ]}
            />
          )
        ) : isGuardian ? (
          <CardBody className="pt-2">
            {pendingCount === 0 ? (
              <EmptyState
                icon="CircleCheck"
                title="Allt är signerat"
                description="Det finns inga samtycken som väntar på ditt svar just nu."
              />
            ) : (
              <div className="space-y-4">
                {pendingByChild
                  .filter((g) => g.pending.length > 0)
                  .map((g) => (
                    <GuardianChildCard
                      key={g.student.id}
                      student={g.student}
                      pending={g.pending}
                      onChanged={bump}
                    />
                  ))}
              </div>
            )}
          </CardBody>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="ClipboardCheck"
            title="Inga samtyckesförfrågningar"
            description="Skicka ut ett samtycke så visas det här med svarsstatus."
            actionLabel={canCreate ? 'Nytt samtycke' : undefined}
            onAction={canCreate ? () => setCreateOpen(true) : undefined}
          />
        ) : (
          <DataTable
            columns={requestColumns}
            rows={rows}
            caption="Samtyckesförfrågningar"
          />
        )}
      </Card>

      {createOpen && (
        <CreateConsentModal
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
// Vårdnadshavare: väntande samtycken per barn
// ---------------------------------------------------------------------------

function GuardianChildCard({
  student,
  pending,
  onChanged,
}: {
  student: Student
  pending: RequestRow[]
  onChanged: () => void
}) {
  const principal = usePrincipal()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function respond(row: RequestRow, decision: 'godkänt' | 'avböjt') {
    setBusyId(row.id)
    try {
      await wait(280)
      signConsent(principal, row.request.id, decision)
      if (decision === 'godkänt') {
        toast.success('Signerat', `«${row.request.title}» har godkänts.`)
      } else {
        toast.success('Svar registrerat', `Du avböjde «${row.request.title}».`)
      }
      onChanged()
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else if (e instanceof RateLimitedError) toast.warning('För många åtgärder', e.message)
      else
        toast.error(
          'Kunde inte signera',
          e instanceof Error ? e.message : 'Försök igen om en stund.',
        )
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card className="shadow-none">
      <CardHeader
        title={`${student.firstName} ${student.lastName}`}
        subtitle={`${student.gradeLabel} · ${pending.length} ${pending.length === 1 ? 'samtycke väntar' : 'samtycken väntar'}`}
        icon="PenLine"
      />
      <CardBody className="space-y-3">
        {pending.map((row) => {
          const template = db.data.consentTemplates.find((t) => t.id === row.request.templateId)
          const busy = busyId === row.id
          return (
            <div key={row.id} className="rounded-field border border-border p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-ink">{row.request.title}</div>
                  {template && (
                    <p className="mt-0.5 text-sm text-ink-muted">{template.description}</p>
                  )}
                </div>
                <StatusBadge
                  tone={STATUS_META[row.request.status].tone}
                  icon={STATUS_META[row.request.status].icon}
                  label={CONSENT_STATUS_LABEL[row.request.status]}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <DueLabel dueAt={row.request.dueAt} />
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="CircleX"
                    disabled={busyId !== null}
                    loading={busy}
                    onClick={() => respond(row, 'avböjt')}
                  >
                    Avböj
                  </Button>
                  <Button
                    size="sm"
                    icon="CircleCheck"
                    disabled={busyId !== null}
                    loading={busy}
                    onClick={() => respond(row, 'godkänt')}
                  >
                    Godkänn
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Nytt samtycke (personal/admin)
// ---------------------------------------------------------------------------

function CreateConsentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const principal = usePrincipal()
  const templates = db.data.consentTemplates

  const eligibleStudents = useMemo(
    () =>
      db.data.students
        .filter((s) => s.status === 'inskriven')
        .filter(
          (s) =>
            can(principal, 'create', 'consent', {
              organizationId: s.organizationId,
              schoolId: s.schoolId,
              classId: s.classId,
              studentId: s.id,
              protectedIdentity: s.protectedIdentity,
            }).allowed,
        )
        .sort((a, b) => a.lastName.localeCompare(b.lastName, 'sv')),
    [principal],
  )

  const eligibleClasses = useMemo(() => {
    const classIds = new Set(eligibleStudents.map((s) => s.classId).filter(Boolean))
    return db.data.classes.filter((c) => classIds.has(c.id))
  }, [eligibleStudents])

  const defaultDue = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 14)
    return fmtDate(d)
  }, [])

  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [mode, setMode] = useState<'elev' | 'klass'>('elev')
  const [studentId, setStudentId] = useState(eligibleStudents[0]?.id ?? '')
  const [classId, setClassId] = useState(eligibleClasses[0]?.id ?? '')
  const [dueDate, setDueDate] = useState(defaultDue)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const template = templates.find((t) => t.id === templateId)
  const targetStudentIds = useMemo(
    () =>
      mode === 'elev'
        ? studentId
          ? [studentId]
          : []
        : eligibleStudents.filter((s) => s.classId === classId).map((s) => s.id),
    [mode, studentId, classId, eligibleStudents],
  )

  const dueValid = Boolean(dueDate) && new Date(dueDate).getTime() > Date.now() - 86_400_000
  const valid = Boolean(templateId) && targetStudentIds.length > 0 && dueValid

  async function submit() {
    setError(null)
    if (!valid) return
    setSaving(true)
    try {
      await wait(320)
      const created = createConsentRequests(principal, {
        templateId,
        studentIds: targetStudentIds,
        dueAt: new Date(`${dueDate}T23:59:00`).toISOString(),
      })
      toast.success(
        'Samtycke utskickat',
        created.length === 1
          ? 'Vårdnadshavarna har notifierats.'
          : `${created.length} förfrågningar skapades och vårdnadshavarna notifierades.`,
      )
      onCreated()
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else if (e instanceof RateLimitedError) toast.warning('För många åtgärder', e.message)
      else setError(e instanceof Error ? e.message : 'Samtycket kunde inte skickas just nu.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nytt samtycke"
      description="Välj mall och mottagare – vårdnadshavarna notifieras direkt."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Avbryt
          </Button>
          <Button
            icon="Send"
            loading={saving}
            disabled={!valid || saving}
            title={!valid ? 'Välj mall, mottagare och ett giltigt förfallodatum' : undefined}
            onClick={submit}
          >
            {saving
              ? 'Skickar…'
              : targetStudentIds.length > 1
                ? `Skicka till ${targetStudentIds.length} elever`
                : 'Skicka samtycke'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Mall <span className="text-danger">*</span>
          </label>
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </Select>
          {template && (
            <p className="mt-1.5 rounded-field bg-surface-2 px-3 py-2 text-sm text-ink-muted">
              {template.description}
              {template.requiresBothGuardians && (
                <span className="mt-1 flex items-center gap-1.5 text-2xs font-medium text-warning">
                  <Icon name="Users" className="h-3.5 w-3.5" />
                  Kräver svar från båda vårdnadshavarna.
                </span>
              )}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Mottagare</label>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'elev', label: 'En elev', icon: 'User' },
              { value: 'klass', label: 'Hel klass', icon: 'Users' },
            ]}
          />
          <div className="mt-2">
            {mode === 'elev' ? (
              <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                {eligibleStudents.length === 0 && (
                  <option value="">Inga elever i din räckvidd</option>
                )}
                {eligibleStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.protectedIdentity && !principal.protectedClearance
                      ? maskName(`${s.firstName} ${s.lastName}`)
                      : `${s.lastName}, ${s.firstName}`}{' '}
                    · {s.gradeLabel}
                  </option>
                ))}
              </Select>
            ) : (
              <>
                <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
                  {eligibleClasses.length === 0 && (
                    <option value="">Inga klasser i din räckvidd</option>
                  )}
                  {eligibleClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.gradeLabel}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-2xs text-ink-subtle">
                  {targetStudentIds.length}{' '}
                  {targetStudentIds.length === 1 ? 'elev omfattas' : 'elever omfattas'} – en
                  förfrågan skapas per elev.
                </p>
              </>
            )}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Förfallodatum <span className="text-danger">*</span>
          </label>
          <TextInput
            type="date"
            icon="Calendar"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          {!dueValid && (
            <p className="mt-1 text-2xs text-danger">Välj ett datum framåt i tiden.</p>
          )}
        </div>
      </div>
    </Modal>
  )
}
