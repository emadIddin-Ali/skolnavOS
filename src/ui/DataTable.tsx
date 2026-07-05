import { cn } from '@/lib/cn'
import { LoadingRows, EmptyState } from './States'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => React.ReactNode
  className?: string
  align?: 'left' | 'right' | 'center'
  hideOnMobile?: boolean
}

/** Tillgänglig, kompakt tabell med laddnings- och tomtillstånd. */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  onRowClick,
  emptyTitle = 'Inget att visa',
  emptyDescription,
  caption,
}: {
  columns: Column<T>[]
  rows: T[]
  loading?: boolean
  onRowClick?: (row: T) => void
  emptyTitle?: string
  emptyDescription?: string
  caption?: string
}) {
  if (loading) return <LoadingRows />
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-border text-left">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'whitespace-nowrap px-3 py-2.5 text-2xs font-semibold uppercase tracking-wide text-ink-subtle',
                  c.align === 'right' && 'text-right',
                  c.align === 'center' && 'text-center',
                  c.hideOnMobile && 'hidden md:table-cell',
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-b border-border/70 last:border-0',
                onRowClick && 'cursor-pointer row-hover focus-within:bg-surface-2',
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'px-3 py-2.5 text-ink align-middle',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                    c.hideOnMobile && 'hidden md:table-cell',
                    c.className,
                  )}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
