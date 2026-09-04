/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep rose accent with neutrals carrying a slight plum bias, so the
        // greys read as chosen rather than inherited. Status colours stay
        // separate from the accent: amber warns, red is destructive, green
        // confirms, and burnt orange is reserved for "deal with this".
        ink: '#241820',
        muted: '#6f6068',
        paper: '#faf8f9',
        surface: '#ffffff',
        shell: '#f4eef1',
        line: '#e8dde2',
        accent: '#b3164f',
        deep: '#8d0f3e',
        alert: '#c2410c',
        palm: '#15774f',
        danger: '#b02a20',
        warning: '#a16207',
      },
      borderRadius: {
        DEFAULT: '6px',
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '8px',
        '2xl': '10px',
        '3xl': '12px',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(36, 24, 32, 0.06)',
        glow: '0 1px 2px rgba(179, 22, 79, 0.18)',
        pop: '0 12px 32px rgba(36, 24, 32, 0.16)',
      },
      fontWeight: {
        medium: '500',
        semibold: '560',
        bold: '600',
        black: '660',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
