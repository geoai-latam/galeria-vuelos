import { O2Head } from '../components/layout'
import { ExploradorVuelos } from '../components/sections/o2-explorador'
import { getAllVuelos } from '../lib/content'
import { siteConfig } from '../data/site'

// El explorador ocupa la pantalla entera: sin navbar ni pie, pero con las
// mismas etiquetas de SEO que pone O2Shell en las demás páginas.
// /vuelos (la ruta que tenía en el sitio de GeoAI LATAM) redirige acá, con su
// ?v=<slug> (next.config.js).
export default function Explorador({ vuelos }) {
  return (
    <>
      <O2Head
        title={`Vuelos de dron | ${siteConfig.name}`}
        description={siteConfig.description}
        path="/"
        ogImage="/images/vuelos/tintal.jpg"
      />
      <ExploradorVuelos vuelos={vuelos} />
    </>
  )
}

export async function getStaticProps() {
  return { props: { vuelos: getAllVuelos() } }
}
