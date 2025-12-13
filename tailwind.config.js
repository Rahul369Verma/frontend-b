/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0e1117",
        surface: "#262730",
        primary: "#ff4b4b", // Streamlit Red
        secondary: "#31333F",
        success: "#09ab3b",
        danger: "#ff2b2b",
        warning: "#ffbd45",
      },
      fontFamily: {
        sans: ['"Source Sans Pro"', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
