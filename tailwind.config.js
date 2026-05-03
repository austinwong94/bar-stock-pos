/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#2b1b27',
        paper: '#fff7fa',
        line: '#f0c9d7',
        accent: '#008f8c',
        lagoon: '#00a6a3',
        coral: '#ff6f91',
        palm: '#2fbf71',
        shell: '#fff0f5',
        danger: '#b42318',
        warning: '#b54708',
      },
      boxShadow: {
        soft: '0 18px 48px rgba(196, 70, 115, 0.15)',
        glow: '0 18px 60px rgba(0, 166, 163, 0.18)',
      },
    },
  },
  plugins: [],
};
