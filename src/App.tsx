import { MapView } from './components/MapView'
import { FALLBACK_PLACE } from './lib/constants'

export default function App() {
  return (
    <div className="app">
      <MapView center={FALLBACK_PLACE} />
    </div>
  )
}
