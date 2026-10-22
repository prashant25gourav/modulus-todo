export const theme = {
  colors: {
    primary: '#4F46E5', // Indigo-600
    primaryDark: '#4338CA',
    primaryLight: '#6366F1',
    background: '#0F172A', // Slate-900 dark theme
    surface: '#1E293B', // Slate-800
    surfaceLight: '#334155', // Slate-700
    text: '#F8FAFC', // Slate-50
    textSecondary: '#94A3B8', // Slate-400
    textMuted: '#64748B', // Slate-500
    border: '#334155', // Slate-700
    error: '#EF4444', // Red-500
    errorBackground: 'rgba(239, 68, 68, 0.1)',
    success: '#10B981', // Emerald-500
    successBackground: 'rgba(16, 185, 129, 0.1)',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  borderRadius: {
    sm: 6,
    md: 10,
    lg: 16,
    full: 9999,
  },
  typography: {
    h1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34 },
    h2: { fontSize: 22, fontWeight: '600' as const, lineHeight: 28 },
    h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
    body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
    bodySmall: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
    button: { fontSize: 16, fontWeight: '600' as const, lineHeight: 22 },
    caption: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
  },
};
