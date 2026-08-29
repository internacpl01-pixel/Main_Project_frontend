/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,html}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        slate: {
          850: '#1e293b',
        }
      },
      // Used by the super admin console's company stack. translateY only — the
      // panes carry their own 3D placement on the element inside this one, so
      // an animation that wrote a full transform here would erase it.
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        // The global "a request is in flight" stripe. Indeterminate on purpose:
        // the server does not report how far through a query it is, so a bar
        // that filled 0->100% would be inventing a number. A stripe that keeps
        // travelling says "working" without claiming to know how much is left.
        progress: {
          '0%': { transform: 'translateX(-100%) scaleX(0.35)' },
          '50%': { transform: 'translateX(20%) scaleX(0.6)' },
          '100%': { transform: 'translateX(100%) scaleX(0.35)' },
        },
        // What the stripe does instead when the system asks for less motion.
        // Not nothing: a progress indicator that has stopped moving is a
        // progress indicator that says nothing, and this one only exists while
        // the app is genuinely working. Travel and scale are what cause
        // discomfort, so both are dropped and only the opacity breathes.
        'progress-still': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        float: 'float 7s ease-in-out infinite',
        progress: 'progress 1.15s ease-in-out infinite',
        'progress-still': 'progress-still 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
