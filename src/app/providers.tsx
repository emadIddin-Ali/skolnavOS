import { Component, useEffect, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSession, applyDocumentAttributes } from '@/core/state/session'
import { ErrorState, Toaster } from '@/ui'

/** Kostnadsmedveten cache: undvik onödiga refetch, håll data en stund. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function ThemeSync({ children }: { children: ReactNode }) {
  const theme = useSession((s) => s.theme)
  const mode = useSession((s) => s.mode)
  useEffect(() => {
    applyDocumentAttributes(theme, mode)
  }, [theme, mode])
  return <>{children}</>
}

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-dvh place-items-center bg-bg p-6">
          <div className="max-w-md rounded-card border border-border bg-surface shadow-card">
            <ErrorState
              description="Ett oväntat fel inträffade. Ladda om sidan för att fortsätta. Inga uppgifter har gått förlorade."
              onRetry={() => window.location.reload()}
            />
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeSync>
          {children}
          <Toaster />
        </ThemeSync>
      </QueryClientProvider>
    </RootErrorBoundary>
  )
}
