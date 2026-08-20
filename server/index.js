import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { ensureAdmin } from './db.js'
import { app } from './app.js'
import { startJobs } from './jobs.js'

ensureAdmin(process.env.ADMIN_PASSWORD)

const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '0.0.0.0'
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(rootDir, 'dist')
  app.use(express.static(distDir, { index: false }))
  app.get('{*path}', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({ root: rootDir, server: { middlewareMode: true }, appType: 'spa' })
  app.use(vite.middlewares)
}

app.listen(port, host, (error) => {
  if (error) {
    console.error(`服务启动失败：${error.message}`)
    process.exitCode = 1
    return
  }
  console.log(`护士排班系统已启动：http://${host}:${port}`)
  startJobs()
})
