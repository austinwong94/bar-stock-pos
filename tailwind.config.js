/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // One accent (deep ocean teal), a clay second, and status colours
        // that are deliberately separate from both.
        ink: '#12211f',
        muted: '#616e6c',
        paper: '#f5f7f6',
        surface: '#ffffff',
        shell: '#eceff0',
        line: '#dde3e2',
        accent: '#0d6e64',
        lagoon: '#0a564e',
        coral: '#b4532f',
        palm: '#15774f',
        danger: '#b02a20',
        warning: '#96620a',
      },
      // Small, even radii. The old scale went up to 32px and read as toy-like.
      borderRadius: {
        DEFAULT: '6px',
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '8px',
        '2xl': '10px',
        '3xl': '12px',
      },
      // Hairline borders carry the structure now, so shadows stay almost
      // invisible and are reserved for things that genuinely float.
      boxShadow: {
        soft: '0 1px 2px rgba(18, 33, 31, 0.05)',
        glow: '0 1px 2px rgba(13, 110, 100, 0.16)',
        pop: '0 12px 32px rgba(18, 33, 31, 0.14)',
      },
      fontWeight: {
        // font-black was 900 on nearly every label. Retuned so the same
        // markup reads as a considered hierarchy instead of a shout.
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
