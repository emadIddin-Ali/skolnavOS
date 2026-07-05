import { cn } from '@/lib/cn'
import { initials } from '@/lib/format'
import { Icon } from './Icon'

export function Avatar({
  name,
  color = '#1f4e79',
  size = 'md',
  protected: isProtected,
  className,
}: {
  name: string
  color?: string
  size?: 'sm' | 'md' | 'lg'
  protected?: boolean
  className?: string
}) {
  const dim = size === 'sm' ? 'h-7 w-7 text-2xs' : size === 'lg' ? 'h-12 w-12 text-base' : 'h-9 w-9 text-xs'
  return (
    <span
      className={cn('relative grid shrink-0 place-items-center rounded-full font-semibold text-white', dim, className)}
      style={{ backgroundColor: isProtected ? '#6b7280' : color }}
      aria-label={name}
    >
      {isProtected ? <Icon name="ShieldAlert" className="h-4 w-4" /> : initials(name)}
    </span>
  )
}
