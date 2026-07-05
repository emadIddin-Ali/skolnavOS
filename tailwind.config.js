/** @type {import('tailwindcss').Config} */

// Colors are driven by CSS variables (see src/styles/tokens.css) so that the
// three global modes (Årskurs 1–9 / Gymnasium-Vux / Personal-Admin) and
// light/dark can retint the whole system without touching component code.
// Variables hold space-separated RGB channels so Tailwind's <alpha-value>
// opacity modifiers keep working (e.g. bg-primary/10).
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: rgb('--c-bg'),
        surface: rgb('--c-surface'),
        'surface-2': rgb('--c-surface-2'),
        'surface-3': rgb('--c-surface-3'),
        border: rgb('--c-border'),
        'border-strong': rgb('--c-border-strong'),
        ink: rgb('--c-ink'),
        'ink-muted': rgb('--c-ink-muted'),
        'ink-subtle': rgb('--c-ink-subtle'),
        primary: {
          DEFAULT: rgb('--c-primary'),
          fg: rgb('--c-primary-fg'),
          soft: rgb('--c-primary-soft'),
          strong: rgb('--c-primary-strong'),
        },
        accent: {
          DEFAULT: rgb('--c-accent'),
          soft: rgb('--c-accent-soft'),
        },
        success: { DEFAULT: rgb('--c-success'), soft: rgb('--c-success-soft') },
        warning: { DEFAULT: rgb('--c-warning'), soft: rgb('--c-warning-soft') },
        danger: { DEFAULT: rgb('--c-danger'), soft: rgb('--c-danger-soft') },
        info: { DEFAULT: rgb('--c-info'), soft: rgb('--c-info-soft') },
        // Data classification scale (1 Publik → 6 Säkerhetsdata)
        'class-1': rgb('--c-class-1'),
        'class-2': rgb('--c-class-2'),
        'class-3': rgb('--c-class-3'),
        'class-4': rgb('--c-class-4'),
        'class-5': rgb('--c-class-5'),
        'class-6': rgb('--c-class-6'),
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        // Soft, institutional rounding
        card: '16px',
        panel: '20px',
        field: '10px',
        pill: '999px',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        panel: '0 4px 24px -8px rgb(15 23 42 / 0.12), 0 2px 6px -2px rgb(15 23 42 / 0.06)',
        pop: '0 12px 40px -12px rgb(15 23 42 / 0.22)',
        focus: '0 0 0 3px rgb(var(--c-primary) / 0.28)',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      transitionDuration: {
        DEFAULT: '160ms',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 200ms cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
}
