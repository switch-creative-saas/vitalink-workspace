import animate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sentinel: {
          blue: '#1B3A8F',
          indigo: '#3730A3',
          purple: '#7C3AED',
          critical: '#DC2626',
          high: '#EA580C',
          moderate: '#D97706',
          low: '#16A34A',
          dark: '#0F1629',
          surface: '#1A2340',
          elevated: '#1E2A4A'
        }
      },
      boxShadow: {
        sentinel: '0 20px 60px rgba(0,0,0,0.35)'
      },
      animation: {
        'slide-in-right': 'slide-in-right 220ms ease-out',
        'pulse-critical': 'pulse-critical 1.8s ease-in-out infinite'
      },
      keyframes: {
        'slide-in-right': {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' }
        },
        'pulse-critical': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(220,38,38,0.32)' },
          '50%': { boxShadow: '0 0 0 8px rgba(220,38,38,0)' }
        }
      }
    }
  },
  plugins: [animate],
};
