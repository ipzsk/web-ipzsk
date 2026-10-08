import './home.css'
import '@/ui/ui.css'

// Paint the generated HTML before downloading the interactive account UI.
requestAnimationFrame(() => setTimeout(() => { void import('./hydrate') }, 0))
