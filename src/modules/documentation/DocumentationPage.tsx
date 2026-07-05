import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  PageHeader, Card, StatCard, Segmented, Button, Badge, Avatar, Modal,
  TextInput, Icon, EmptyState, DeniedState, LoadingRows, toast,
} from '@/ui'
import { Popover, MenuItem } from '@/ui/Popover'
import { usePrincipal, usePermission } from '@/core/permissions/usePermission'
import { can, ForbiddenError, type Principal } from '@/core/permissions/engine'
import { db, byId } from '@/data/db/store'
import type { DocumentationPost, Student } from '@/data/schema'
import { fmtRelative, maskName } from '@/lib/format'
import {
  createDocumentationPost,
  updateDocumentationPost,
  deleteDocumentationPost,
  type DocumentationInput,
} from './service'

type FilterKey = 'alla' | 'mina'

const TEXTAREA_CLS =
  'w-full rounded-field border border-border bg-surface p-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50'

export function DocumentationPage() {
  const principal = usePrincipal()
  const readDecision = usePermission('read', 'documentation')
  const canCreate = usePermission('create', 'documentation').allowed
  const canUpdate = usePermission('update', 'documentation').allowed
  const canDelete = usePermission('delete', 'documentation').allowed

  const isGuardian = principal.role === 'vardnadshavare'
  const isStudent = principal.role === 'elev_grund' || principal.role === 'elev_gy'
  const isReader = isGuardian || isStudent

  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>('alla')
  const [refresh, bump] = useReducer((x: number) => x + 1, 0)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<DocumentationPost | null>(null)
  const [deleting, setDeleting] = useState<DocumentationPost | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 240)
    return () => clearTimeout(t)
  }, [])

  // Behörighetsfiltrerat flöde per roll.
  const posts = useMemo(() => {
    void refresh
    const all = db.data.documentation.filter((p) => !p.deletedAt)
    let visible: DocumentationPost[]
    if (isGuardian) {
      const childIds = principal.guardianStudentIds.filter(
        (sid) => principal.guardianPermsByStudent[sid]?.viewDocumentation !== false,
      )
      visible = all.filter(
        (p) => p.visibleToGuardians && p.studentIds.some((sid) => childIds.includes(sid)),
      )
    } else if (isStudent) {
      visible = all.filter(
        (p) =>
          p.visibleToGuardians &&
          principal.ownStudentId != null &&
          p.studentIds.includes(principal.ownStudentId),
      )
    } else {
      visible = all.filter(
        (p) =>
          can(principal, 'read', 'documentation', {
            organizationId: p.organizationId,
            schoolId: p.schoolId,
            classId: p.classId,
          }).allowed,
      )
    }
    return [...visible].sort((a, b) => b.postedAt.localeCompare(a.postedAt))
  }, [principal, isGuardian, isStudent, refresh])

  const mineCount = useMemo(
    () => posts.filter((p) => p.authorUserId === principal.userId).length,
    [posts, principal.userId],
  )

  const visiblePosts = useMemo(
    () => (filter === 'mina' ? posts.filter((p) => p.authorUserId === principal.userId) : posts),
    [posts, filter, principal.userId],
  )

  function confirmDelete() {
    if (!deleting) return
    setRemoveBusy(true)
    try {
      deleteDocumentationPost(principal, deleting.id)
      toast.success('Inlägget togs bort', 'Borttagningen är loggad i granskningsloggen.')
      setDeleting(null)
      bump()
    } catch (e) {
      if (e instanceof ForbiddenError) toast.error('Åtkomst nekad', e.message)
      else toast.error('Kunde inte ta bort', 'Försök igen om en stund.')
    } finally {
      setRemoveBusy(false)
    }
  }

  if (!readDecision.allowed) {
    return (
      <>
        <PageHeader title="Dokumentation" icon="NotebookPen" />
        <Card>
          <DeniedState reason={readDecision.reason} />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Dokumentation"
        icon="NotebookPen"
        subtitle={
          isReader
            ? 'Pedagogisk dokumentation som skolan delat med hemmet.'
            : 'Pedagogisk dokumentation – lärloggar och lärande i vardagen.'
        }
        actions={
          canCreate && !isReader ? (
            <Button icon="Plus" onClick={() => setFormOpen(true)}>
              Ny dokumentation
            </Button>
          ) : undefined
        }
      />

      {!isReader && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <StatCard label="Inlägg i ditt flöde" value={posts.length} icon="NotebookPen" tone="primary" />
          <StatCard
            label="Synliga för vårdnadshavare"
            value={posts.filter((p) => p.visibleToGuardians).length}
            icon="Eye"
            tone="success"
          />
          <StatCard label="Dina inlägg" value={mineCount} icon="PenLine" tone="neutral" />
        </div>
      )}

      {!isReader && (
        <div className="mb-4">
          <Segmented
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'alla', label: `Alla (${posts.length})` },
              { value: 'mina', label: `Mina inlägg (${mineCount})` },
            ]}
          />
        </div>
      )}

      {loading ? (
        <Card>
          <LoadingRows rows={4} />
        </Card>
      ) : visiblePosts.length === 0 ? (
        <Card>
          <EmptyState
            icon="NotebookPen"
            title={
              filter === 'mina'
                ? 'Du har inga egna inlägg än'
                : isReader
                  ? 'Ingen dokumentation delad än'
                  : 'Ingen dokumentation i ditt flöde'
            }
            description={
              isReader
                ? 'När pedagogerna delar dokumentation om ditt barn visas den här.'
                : 'Dokumentera lärande och aktiviteter – tagga barnen som deltog.'
            }
            actionLabel={canCreate && !isReader ? 'Ny dokumentation' : undefined}
            onAction={canCreate && !isReader ? () => setFormOpen(true) : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {visiblePosts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              principal={principal}
              isReader={isReader}
              canEdit={canUpdate}
              canDelete={canDelete}
              onEdit={() => setEditing(p)}
              onDelete={() => setDeleting(p)}
            />
          ))}
        </div>
      )}

      {(formOpen || editing) && (
        <DocumentationFormModal
          post={editing}
          principal={principal}
          onClose={() => {
            setFormOpen(false)
            setEditing(null)
          }}
          onSaved={() => {
            setFormOpen(false)
            setEditing(null)
            bump()
          }}
        />
      )}

      {deleting && (
        <Modal
          open
          onClose={() => setDeleting(null)}
          title="Ta bort inlägg"
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Avbryt
              </Button>
              <Button variant="danger" icon="Trash2" loading={removeBusy} onClick={confirmDelete}>
                Ta bort
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-muted">
            Inlägget «{deleting.title}» döljs för alla, även vårdnadshavare. Åtgärden loggas i
            granskningsloggen.
          </p>
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Flödeskort
// ---------------------------------------------------------------------------

function PostCard({
  post,
  principal,
  isReader,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  post: DocumentationPost
  principal: Principal
  isReader: boolean
  canEdit: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const author = byId(db.data.users, post.authorUserId)
  const cls = byId(db.data.classes, post.classId)
  const own = post.authorUserId === principal.userId

  const tagged = post.studentIds
    .map((sid) => byId(db.data.students, sid))
    .filter((s): s is Student => Boolean(s))

  // Läsare ser endast sina egna barn i taggningen – övriga visas som antal.
  const shown = principal.role === 'vardnadshavare'
    ? tagged.filter((s) => principal.guardianStudentIds.includes(s.id))
    : principal.ownStudentId
      ? tagged.filter((s) => s.id === principal.ownStudentId)
      : tagged
  const hiddenCount = tagged.length - shown.length
  const anyMasked = shown.some((s) => s.protectedIdentity && !principal.protectedClearance)

  return (
    <Card>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={author?.name ?? 'Okänd'} color={author?.avatarColor} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">
                {author?.name ?? 'Okänd användare'}
                {own && <span className="text-ink-subtle"> (du)</span>}
              </div>
              <div className="text-2xs text-ink-subtle">
                {fmtRelative(post.postedAt)}
                {cls ? ` · ${cls.name}` : ''}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {!isReader && (
              post.visibleToGuardians ? (
                <Badge tone="success" icon="Eye">
                  Synlig för vårdnadshavare
                </Badge>
              ) : (
                <Badge tone="neutral" icon="EyeOff">
                  Endast personal
                </Badge>
              )
            )}
            {own && canEdit && (
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
                  <>
                    <MenuItem
                      icon="PenLine"
                      onClick={() => {
                        close()
                        onEdit()
                      }}
                    >
                      Redigera
                    </MenuItem>
                    {canDelete && (
                      <MenuItem
                        icon="Trash2"
                        danger
                        onClick={() => {
                          close()
                          onDelete()
                        }}
                      >
                        Ta bort
                      </MenuItem>
                    )}
                  </>
                )}
              </Popover>
            )}
          </div>
        </div>

        <h3 className="mt-4 font-semibold text-ink">{post.title}</h3>
        <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{post.body}</p>

        {(shown.length > 0 || hiddenCount > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {shown.map((s) => {
              const masked = s.protectedIdentity && !principal.protectedClearance
              const name = `${s.firstName} ${s.lastName}`
              return (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface-2 py-1 pl-1 pr-2.5 text-xs text-ink"
                >
                  <Avatar name={name} color={s.photoColor} size="sm" protected={masked} />
                  {masked ? maskName(name) : name}
                </span>
              )
            })}
            {hiddenCount > 0 && (
              <Badge tone="neutral" icon="Users">
                +{hiddenCount} barn
              </Badge>
            )}
          </div>
        )}

        {anyMasked && (
          <p className="mt-2 flex items-center gap-1.5 text-2xs text-warning">
            <Icon name="ShieldAlert" className="h-3.5 w-3.5 shrink-0" />
            Skyddad identitet – namn visas maskerade.
          </p>
        )}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Skapa/redigera dokumentation
// ---------------------------------------------------------------------------

function DocumentationFormModal({
  post,
  principal,
  onClose,
  onSaved,
}: {
  post: DocumentationPost | null
  principal: Principal
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(post?.title ?? '')
  const [body, setBody] = useState(post?.body ?? '')
  const [selected, setSelected] = useState<string[]>(post?.studentIds ?? [])
  const [visibleToGuardians, setVisibleToGuardians] = useState(post?.visibleToGuardians ?? true)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Barn inom författarens räckvidd (klass-scope om satt, annars skola).
  const scopeStudents = useMemo(() => {
    const base =
      principal.classIds.length > 0
        ? db.data.students.filter((s) => s.classId && principal.classIds.includes(s.classId))
        : db.data.students.filter((s) => principal.schoolIds.includes(s.schoolId))
    const map = new Map(base.filter((s) => !s.deletedAt && s.status === 'inskriven').map((s) => [s.id, s]))
    // Vid redigering ska redan taggade barn alltid finnas i listan.
    for (const sid of post?.studentIds ?? []) {
      const s = byId(db.data.students, sid)
      if (s && !map.has(s.id)) map.set(s.id, s)
    }
    return [...map.values()].sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'sv'),
    )
  }, [principal, post])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return scopeStudents
    return scopeStudents.filter((s) =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q),
    )
  }, [scopeStudents, search])

  const valid = title.trim().length > 0 && body.trim().length > 0 && selected.length > 0

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function submit() {
    setError(null)
    if (!valid) {
      setError('Fyll i titel och text samt tagga minst ett barn.')
      return
    }
    setBusy(true)
    const input: DocumentationInput = {
      title,
      body,
      studentIds: selected,
      visibleToGuardians,
    }
    try {
      if (post) {
        updateDocumentationPost(principal, post.id, input)
        toast.success('Inlägget uppdaterades')
      } else {
        createDocumentationPost(principal, input)
        toast.success(
          'Dokumentationen publicerades',
          visibleToGuardians
            ? 'Vårdnadshavare till taggade barn kan nu läsa inlägget.'
            : 'Inlägget är endast synligt för personal.',
        )
      }
      onSaved()
    } catch (e) {
      if (e instanceof ForbiddenError) {
        setError(e.message)
        toast.error('Åtkomst nekad', e.message)
      } else {
        setError('Det gick inte att spara just nu. Försök igen om en stund.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={post ? 'Redigera dokumentation' : 'Ny dokumentation'}
      description="Beskriv aktiviteten och tagga barnen som deltog."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button
            icon="Save"
            loading={busy}
            disabled={!valid}
            title={valid ? undefined : 'Titel, text och minst ett taggat barn krävs'}
            onClick={submit}
          >
            {post ? 'Spara ändringar' : 'Publicera'}
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
          <label className="mb-1.5 block text-sm font-medium text-ink">Titel</label>
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="T.ex. Utforskande i skogen"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">Text</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Vad gjorde barnen? Vad lärde de sig?"
            className={TEXTAREA_CLS}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Taggade barn <span className="text-ink-subtle">({selected.length} valda)</span>
          </label>
          {scopeStudents.length > 6 && (
            <TextInput
              icon="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök barn…"
              className="mb-2"
            />
          )}
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-field border border-border p-1.5">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-sm text-ink-subtle">Inga barn matchar sökningen.</p>
            ) : (
              filtered.map((s) => {
                const checked = selected.includes(s.id)
                const masked = s.protectedIdentity && !principal.protectedClearance
                const name = `${s.firstName} ${s.lastName}`
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={masked}
                    title={
                      masked
                        ? 'Skyddad identitet – kan inte taggas utan särskild behörighet.'
                        : undefined
                    }
                    onClick={() => toggle(s.id)}
                    className={
                      'flex w-full items-center gap-2.5 rounded-field px-2 py-1.5 text-left text-sm transition-colors ' +
                      (checked ? 'bg-primary-soft' : 'hover:bg-surface-2') +
                      (masked ? ' opacity-60' : '')
                    }
                  >
                    <span
                      className={
                        'grid h-5 w-5 shrink-0 place-items-center rounded border ' +
                        (checked
                          ? 'border-transparent bg-primary text-primary-fg'
                          : 'border-border-strong text-transparent')
                      }
                    >
                      <Icon name="Check" className="h-3.5 w-3.5" />
                    </span>
                    <Avatar name={name} color={s.photoColor} size="sm" protected={masked} />
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {masked ? maskName(name) : name}
                    </span>
                    <span className="shrink-0 text-2xs text-ink-subtle">{s.gradeLabel}</span>
                  </button>
                )
              })
            )}
          </div>
          {selected.length === 0 && (
            <p className="mt-1 text-2xs text-ink-subtle">Tagga minst ett barn.</p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink">
            Synlig för vårdnadshavare
          </label>
          <Segmented
            value={visibleToGuardians ? 'ja' : 'nej'}
            onChange={(v) => setVisibleToGuardians(v === 'ja')}
            options={[
              { value: 'ja', label: 'Ja', icon: 'Eye' },
              { value: 'nej', label: 'Nej', icon: 'EyeOff' },
            ]}
          />
          <p className="mt-1 text-2xs text-ink-subtle">
            {visibleToGuardians
              ? 'Vårdnadshavare till taggade barn kan läsa inlägget.'
              : 'Inlägget visas endast för behörig personal.'}
          </p>
        </div>
      </div>
    </Modal>
  )
}
