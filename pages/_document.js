import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="es">
      <Head>
        {/* Iconos al tamaño en que se usan. Antes el <link rel="icon">
            apuntaba a un PNG de 1024×1024 y 376 KB para pintar 32 px. */}
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:ital,wght@0,400..700;1,400..700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* Acá solo va lo que es igual en TODAS las páginas.

            La description y las etiquetas de Open Graph y Twitter las pone
            cada página a través de O2Shell, con su propio texto y su propia
            portada. `next/head` no deduplica contra _document: tenerlas en
            los dos sitios emitía dos etiquetas por página, y compartir en
            LinkedIn mostraba la misma tarjeta genérica para los 17 posts y
            proyectos. */}
        <meta name="theme-color" content="#1c3328" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
