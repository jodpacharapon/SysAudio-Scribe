import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('Renderer root element is missing from index.html')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
