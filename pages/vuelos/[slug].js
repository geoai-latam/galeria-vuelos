import { O2Shell } from '../../components/layout'
import { VueloDetailO2 } from '../../components/sections/o2-vuelos'
import { getAllVuelos, getVueloBySlug } from '../../lib/content'
import { siteConfig } from '../../data/site'

export default function VueloPage({ vuelo }) {
  // Sin rama para `!vuelo`: fallback:false + notFound:true mandan a 404.js.
  return (
    <O2Shell
      title={`${vuelo.title}, vuelo de dron | ${siteConfig.name}`}
      description={vuelo.descripcion}
      path={`/vuelos/${vuelo.slug}`}
      ogImage={vuelo.miniatura || undefined}
      ogType="article"
    >
      <VueloDetailO2 vuelo={vuelo} />
    </O2Shell>
  )
}

export async function getStaticPaths() {
  return {
    paths: getAllVuelos().map((v) => ({ params: { slug: v.slug } })),
    fallback: false,
  }
}

export async function getStaticProps({ params }) {
  const vuelo = getVueloBySlug(params.slug)
  if (!vuelo) return { notFound: true }
  return { props: { vuelo } }
}
