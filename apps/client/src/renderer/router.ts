import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'

const isElectron = Boolean(window.captureAPI)

export const router = createRouter({
  history: isElectron ? createMemoryHistory() : createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: App },
    { path: '/:roomCode', component: App },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
