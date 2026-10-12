import { createApp, h } from 'vue'
import { RouterView } from 'vue-router'
import { router } from './router'
import { initializeClientTelemetry, logClient } from './services/telemetry'

void initializeClientTelemetry()
import './styles.css'

window.addEventListener('error', (event) => logClient('error', 'client.uncaught', { error: event.error }))
window.addEventListener('unhandledrejection', (event) => logClient('error', 'client.unhandled_rejection', { error: event.reason }))
window.addEventListener('offline', () => logClient('warn', 'client.offline'))
window.addEventListener('online', () => logClient('info', 'client.online'))

const app = createApp({ render: () => h(RouterView) }).use(router)
app.config.errorHandler = (error) => logClient('error', 'vue.render.failed', { error })
app.mount('#app')
