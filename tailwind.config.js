/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './client/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          950: '#0b0d11',
          900: '#0f1218',
          850: '#141821',
          800: '#1a1f2a',
          700: '#242b38',
          600: '#323b4b',
        },
        accent: {
          DEFAULT: '#4f9cff',
          soft: '#79b8ff',
          dim: '#2b5f9e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset',
      },
    },
  },
  plugins: [],
};
