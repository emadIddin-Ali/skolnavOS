import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  PageHeader, Card, StatCard, DataTable, Tabs, Button, Badge, StatusBadge,
  ClassificationBadge, Modal, TextInput, Select, Icon,
  DeniedState, EmptyState, LoadingRows, toast,
} from '@/ui'
import type { Column, Tone } from '@/ui'
import { Popover, MenuItem } from '@/ui/Popover'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError } from '@/core/permissions/engine'
import { RateLimitedError } from '@/core/rate-limit/rateLimit'
import { db, byId, latency } from '@/data/db/store'
import type { StoredFile } from '@/data/schema'
import { fmtBytes, fmtRelative, maskName } from '@/lib/format'
import {
  FILE_CATEGORY_LABEL, FILE_CATEGORIES, validateUpload,
  uploadFile, markFileScanned, downloadStoredFile, addFileVersion, softDeleteFile,
  type UploadFileInput,
} from './service'

// ---- Presentationskartor ----

const CATEGORY_META: Record<StoredFile['category'], { tone: Tone; icon: string }> = {
  skola: { tone: 'primary', icon: 'School' },
  elev: { tone: 'info', icon: 'GraduationCap' },
  intern: { tone: 'neutral', icon: 'Briefcase' },
  samtycke: { tone: 'success', icon: 'PenLine' },
  incident: { tone: 'danger', icon: 'Siren' },
  vardnadshavare: { tone: 'accent', icon: 'HandHeart' },
}

const SCAN_META: Record<StoredFile['scanStatus'], { tone: Tone; icon: string; label: string }> = {
  ren: { tone: 'success', icon: 'ShieldCheck', label: 'Ren' },
  misstänkt: { tone: 'danger', icon: 'ShieldAlert', label: 'Misstänkt' },
  väntar: { tone: 'info', icon: 'ScanLine', label: 'Skannas' },
  ej_skannad: { tone: 'neutral', icon: 'ShieldQuestion', label: 'Ej skannad' },
}

type TabKey = 'alla' | StoredFile['category']

interface FileRow {
  id: string
  file: StoredFile
  masked: boolean
  studentLabel: string | null
  uploaderLabel: string
}

export function FilesPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'file')
  const createDecision = usePermission('create', 'file')
  const canUpdate = usePermission('update', 'file').allowed
  const canDelete = usePermission('delete', 'file').allowed

  const [loading, setLoading] = useState(true)
  const [tick, bump] = useReducer((x) => x + 1, 0)
  const [tab, setTab] = useState<TabKey>('alla')
  const [query, setQuery] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FileRow | null>(null)

  // Timers (virusskanning) rensas vid unmount.
  const timersRef = useRef<number[]>([])
  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => window.clearTimeout(t))
      timersRef.current = []
    }
  }, [])

  useEffect(() => {
    let alive = true
    latency(220).then(() => {
      if (alive) setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  // Behörighetsfiltrerad lista – varje rad prövas mot motorn.
  const rows = useMemo<FileRow[]>(() => {
    void tick
    return db.data.files
      .filter((f) => !f.deletedAt && f.organizationId === principal.organizationId)
      .map<FileRow | null>((f) => {
        const student = byId(db.data.students, f.studentId)
        const decision = can(principal, 'read', 'file', {
          organizationId: f.organizationId,
          schoolId: f.schoolId,
          studentId: f.studentId,
          dataClassification: f.dataClassification,
          protectedIdentity: student?.protectedIdentity,
        })
        if (!decision.allowed) return null
        const masked = Boolean(decision.masked)
        const fullName = student ? `${student.firstName} ${student.lastName}` : null
        return {
          id: f.id,
          file: f,
          masked,
          studentLabel: fullName ? (masked ? maskName(fullName) : fullName) : null,
          uploaderLabel:
            f.uploadedBy === principal.userId
              ? 'Du'
              : byId(db.data.users, f.uploadedBy)?.name ?? 'Okänd',
        }
      })
      .filter((r): r is FileRow => r !== null)
      .sort((a, b) => b.file.createdAt.localeCompare(a.file.createdAt))
  }, [principal, tick])

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = {
      alla: rows.length, skola: 0, elev: 0, intern: 0, samtycke: 0, incident: 0, vardnadshavare: 0,
    }
    for (const r of rows) c[r.file.category] += 1
    return c
  }, [rows])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (tab !== 'alla' && r.file.category !== tab) return false
      if (!q) return true
      return (
        r.file.name.toLowerCase().includes(q) ||
        (r.studentLabel?.toLowerCase().includes(q) ?? false) ||
        FILE_CATEGORY_LABEL[r.file.category].toLowerCase().includes(q)
      )
    })
  }, [rows, tab, query])

  const stats = useMemo(() => {
    let suspicious = 0
    let guardianVisible = 0
    for (const r of rows) {
      if (r.file.scanStatus === 'misstänkt') suspicious += 1
      if (r.file.guardianVisible) guardianVisible += 1
    }
    return { total: rows.length, suspicious, guardianVisible }
  }, [rows])

  function handleDownload(row: FileRow) {
    if (row.file.scanStatus === 'misstänkt') {
      toast.error(
        'Nedladdning spärrad',
        'Virusskanningen har flaggat filen som misstänkt. Den är spärrad i väntan på IT-granskning.',
      )
      return
    }
    if (row.file.scanStatus === 'väntar') {
      toast.warning('Skanning pågår', 'Filen kan laddas ned när virusskanningen är klar.')
      return
    }
    try {
      const fileName = downloadStoredFile(principal, row.file.id)
      toast.success('Fil nedladdad', `${fileName} – demoinnehåll levererat som textversion.`)
    } catch (e) {
      if (e instanceof RateLimitedError) toast.warning('För många nedladdningar', e.message)
      else if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Kunde inte ladda ned', e instanceof Error ? e.message : undefined)
    }
  }

  function handleNewVersion(row: FileRow) {
    try {
      const f = addFileVersion(principal, row.file.id)
      toast.success('Ny version registrerad', `${f.name} är nu version ${f.versionCount}.`)
      bump()
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Kunde inte skapa ny version', e instanceof Error ? e.message : undefined)
    }
  }

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Filer & dokument" icon="FolderOpen" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  const columns: Column<FileRow>[] = [
    {
      key: 'name',
      header: 'Namn',
      render: (r) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-surface-2 text-ink-muted">
            <Icon name="FileText" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="font-medium text-ink truncate">{r.file.name}</div>
            {r.studentLabel && (
              <div className="flex items-center gap-1 text-2xs text-ink-subtle">
                <span className="truncate">{r.studentLabel}</span>
                {r.masked && (
                  <span title="Skyddad identitet – namnet är maskerat">
                    <Icon name="ShieldAlert" className="h-3 w-3 text-warning" />
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Kategori',
      hideOnMobile: true,
      render: (r) => (
        <Badge tone={CATEGORY_META[r.file.category].tone} icon={CATEGORY_META[r.file.category].icon}>
          {FILE_CATEGORY_LABEL[r.file.category]}
        </Badge>
      ),
    },
    {
      key: 'size',
      header: 'Storlek',
      hideOnMobile: true,
      render: (r) => <span className="text-ink-muted tabular-nums">{fmtBytes(r.file.sizeBytes)}</span>,
    },
    {
      key: 'scan',
      header: 'Skanning',
      render: (r) => (
        <StatusBadge
          tone={SCAN_META[r.file.scanStatus].tone}
          icon={SCAN_META[r.file.scanStatus].icon}
          label={SCAN_META[r.file.scanStatus].label}
        />
      ),
    },
    {
      key: 'version',
      header: 'Version',
      hideOnMobile: true,
      render: (r) => <Badge tone="neutral" icon="History">{`v${r.file.versionCount}`}</Badge>,
    },
    {
      key: 'classification',
      header: 'Klassificering',
      hideOnMobile: true,
      render: (r) => <ClassificationBadge level={r.file.dataClassification} />,
    },
    {
      key: 'guardianVisible',
      header: 'Synlighet',
      hideOnMobile: true,
      render: (r) =>
        r.file.guardianVisible ? (
          <span title="Synlig för vårdnadshavare">
            <Badge tone="primary" icon="Eye">VH-synlig</Badge>
          </span>
        ) : (
          <span className="text-ink-subtle">Endast personal</span>
        ),
    },
    {
      key: 'uploaded',
      header: 'Uppladdad',
      hideOnMobile: true,
      render: (r) => (
        <div>
          <div className="text-ink">{r.uploaderLabel}</div>
          <div className="text-2xs text-ink-subtle">{fmtRelative(r.file.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <Popover
          width="w-56"
          trigger={
            <Button variant="ghost" size="sm" iconRight="ChevronDown">
              Åtgärder
            </Button>
          }
        >
          {(close) => (
            <>
              {r.file.scanStatus === 'misstänkt' ? (
                <MenuItem
                  icon="Ban"
                  danger
                  onClick={() => {
                    close()
                    handleDownload(r)
                  }}
                >
                  Nedladdning spärrad
                </MenuItem>
              ) : (
                <MenuItem
                  icon="Download"
                  onClick={() => {
                    close()
                    handleDownload(r)
                  }}
                >
                  Ladda ned
                </MenuItem>
              )}
              {canUpdate && (
                <MenuItem
                  icon="History"
                  onClick={() => {
                    close()
                    handleNewVersion(r)
                  }}
                >
                  Ny version
                </MenuItem>
              )}
              {canDelete && (
                <MenuItem
                  icon="Trash2"
                  danger
                  onClick={() => {
                    close()
                    setDeleteTarget(r)
                  }}
                >
                  Ta bort
                </MenuItem>
              )}
            </>
          )}
        </Popover>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Filer & dokument"
        icon="FolderOpen"
        subtitle="Skolans dokument med virusskanning, versionshistorik och klassificering."
        actions={
          <span title={createDecision.allowed ? undefined : createDecision.reason}>
            <Button icon="Upload" disabled={!createDecision.allowed} onClick={() => setUploadOpen(true)}>
              Ladda upp
            </Button>
          </span>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Dokument" value={stats.total} icon="FolderOpen" tone="primary" />
        <StatCard
          label="Misstänkta filer"
          value={stats.suspicious}
          icon="ShieldAlert"
          tone={stats.suspicious ? 'danger' : 'neutral'}
        />
        <StatCard label="Synliga för vårdnadshavare" value={stats.guardianVisible} icon="Eye" tone="info" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 px-4 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="sm:max-w-xs sm:flex-1">
            <TextInput
              icon="Search"
              placeholder="Sök fil, elev eller kategori …"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Sök bland filer"
            />
          </div>
        </div>
        <div className="px-2 pt-2 sm:px-4">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'alla' as TabKey, label: 'Alla', count: counts.alla },
              ...FILE_CATEGORIES.map((c) => ({
                value: c as TabKey,
                label: FILE_CATEGORY_LABEL[c],
                count: counts[c],
              })),
            ]}
          />
        </div>
        {loading ? (
          <LoadingRows rows={6} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="FolderOpen"
            title={query ? 'Inga träffar' : 'Inga filer i den här kategorin'}
            description={
              query
                ? 'Prova ett annat sökord eller byt kategori.'
                : 'Uppladdade dokument visas här, filtrerade efter din behörighet.'
            }
            actionLabel={!query && createDecision.allowed ? 'Ladda upp' : undefined}
            onAction={!query && createDecision.allowed ? () => setUploadOpen(true) : undefined}
          />
        ) : (
          <DataTable columns={columns} rows={visible} caption="Filer och dokument" />
        )}
      </Card>

      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onUploaded={(fileId) => {
            setUploadOpen(false)
            bump()
            timersRef.current.push(
              window.setTimeout(() => {
                markFileScanned(fileId)
                bump()
              }, 1200),
            )
          }}
        />
      )}

      {deleteTarget && (
        <DeleteFileModal
          row={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null)
            bump()
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Uppladdning
// ---------------------------------------------------------------------------

const CLASSIFICATION_OPTIONS: { value: 2 | 3 | 4; label: string }[] = [
  { value: 2, label: '2 – Intern skoldata' },
  { value: 3, label: '3 – Personuppgifter' },
  { value: 4, label: '4 – Känslig/skyddsvärd skoldata' },
]

function UploadModal({
  onClose,
  onUploaded,
}: {
  onClose: () => void
  onUploaded: (fileId: string) => void
}) {
  const principal = usePrincipal()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [category, setCategory] = useState<StoredFile['category']>('skola')
  const [guardianVisible, setGuardianVisible] = useState(false)
  const [classification, setClassification] = useState<2 | 3 | 4>(2)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const err = validateUpload({ name: f.name, size: f.size })
    setFileError(err)
    setFile(err ? null : f)
  }

  const canSubmit = file != null && !fileError && !saving

  function submit() {
    if (!file) {
      setFileError('Välj en fil att ladda upp.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const input: UploadFileInput = {
        name: file.name,
        sizeBytes: file.size,
        category,
        guardianVisible,
        classification,
      }
      const stored = uploadFile(principal, input)
      toast.success('Filen laddades upp', `${stored.name} – virusskanning pågår.`)
      onUploaded(stored.id)
    } catch (e) {
      if (e instanceof RateLimitedError) {
        toast.warning('Uppladdningsgränsen är nådd', e.message)
        setError(e.message)
      } else if (e instanceof ForbiddenError) {
        toast.error('Åtkomst nekad', e.message)
        setError(e.message)
      } else {
        setError('Filen kunde inte laddas upp just nu. Försök igen om en stund.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ladda upp fil"
      description="PDF, DOCX, XLSX, PNG eller JPG – max 10 MB."
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <span title={canSubmit ? undefined : 'Välj en giltig fil först.'}>
            <Button icon="Upload" loading={saving} disabled={!canSubmit} onClick={submit}>
              Ladda upp
            </Button>
          </span>
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

        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-field border border-dashed border-border-strong bg-surface-2 px-4 py-6 text-center transition-colors hover:bg-surface">
          <Icon name="Upload" className="h-6 w-6 text-ink-subtle" />
          <span className="text-sm font-medium text-ink">
            {file ? `${file.name} (${fmtBytes(file.size)})` : 'Välj fil'}
          </span>
          <span className="text-2xs text-ink-subtle">Tillåtna format: PDF, DOCX, XLSX, PNG, JPG</span>
          <input
            type="file"
            accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg"
            className="sr-only"
            onChange={onFileChange}
          />
        </label>

        {fileError && (
          <div className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{fileError}</span>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Kategori</label>
          <Select value={category} onChange={(e) => setCategory(e.target.value as StoredFile['category'])}>
            {FILE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {FILE_CATEGORY_LABEL[c]}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Dataklassificering</label>
          <Select
            value={String(classification)}
            onChange={(e) => setClassification(Number(e.target.value) as 2 | 3 | 4)}
          >
            {CLASSIFICATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>

        <label className="flex items-start gap-2.5 rounded-field border border-border bg-surface-2 p-3">
          <input
            type="checkbox"
            checked={guardianVisible}
            onChange={(e) => setGuardianVisible(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong"
          />
          <span>
            <span className="block text-sm font-medium text-ink">Synlig för vårdnadshavare</span>
            <span className="block text-2xs text-ink-subtle">
              Vårdnadshavare med dokumentbehörighet kan se och ladda ned filen.
            </span>
          </span>
        </label>

        <p className="flex items-start gap-1.5 text-2xs text-ink-subtle">
          <Icon name="ShieldCheck" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          Filen virusskannas automatiskt efter uppladdning och åtgärden loggas i granskningsloggen.
        </p>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Borttagning med bekräftelse
// ---------------------------------------------------------------------------

function DeleteFileModal({
  row,
  onClose,
  onDeleted,
}: {
  row: FileRow
  onClose: () => void
  onDeleted: () => void
}) {
  const principal = usePrincipal()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function confirm() {
    setError(null)
    setBusy(true)
    try {
      softDeleteFile(principal, row.file.id)
      toast.success('Filen togs bort', `${row.file.name} har flyttats till papperskorgen.`)
      onDeleted()
    } catch (e) {
      if (e instanceof ForbiddenError) setError(e.message)
      else setError('Filen kunde inte tas bort just nu. Försök igen om en stund.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ta bort fil"
      size="sm"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button variant="danger" icon="Trash2" loading={busy} disabled={busy} onClick={confirm}>
            Ta bort
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && (
          <div className="flex items-start gap-2 rounded-field border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <p className="text-sm text-ink">
          Vill du ta bort <span className="font-medium">{row.file.name}</span>?
        </p>
        <p className="text-2xs text-ink-subtle">
          Filen mjukraderas och kan återställas av administratör inom gallringsfristen. Åtgärden
          loggas i granskningsloggen.
        </p>
      </div>
    </Modal>
  )
}
