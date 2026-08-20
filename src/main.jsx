import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles.css'

function preventMultiTouchZoom(event) {
  if (event.touches?.length > 1) event.preventDefault()
}

function preventGestureZoom(event) {
  event.preventDefault()
}

document.addEventListener('touchstart', preventMultiTouchZoom, { passive: false })
document.addEventListener('touchmove', preventMultiTouchZoom, { passive: false })
document.addEventListener('gesturestart', preventGestureZoom, { passive: false })
document.addEventListener('gesturechange', preventGestureZoom, { passive: false })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
