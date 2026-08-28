import { createApp, h } from 'vue'
import { RouterView } from 'vue-router'
import { router } from './router'
import './styles.css'

createApp({ render: () => h(RouterView) }).use(router).mount('#app')
