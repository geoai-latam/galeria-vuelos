import '../styles/globals.css'

// El scroll suave lo define globals.css, envuelto en
// `prefers-reduced-motion: no-preference`. Antes se forzaba desde acá con un
// useEffect que pisaba esa preferencia y la volvía inaplicable.
function MyApp({ Component, pageProps }) {
  return <Component {...pageProps} />
}

export default MyApp
