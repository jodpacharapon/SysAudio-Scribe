import React from 'react'
import ReactDOM from 'react-dom/client'
import { Pill } from './components/Pill'

const root = document.getElementById('pill-root')
if (!root) throw new Error('Pill root element is missing from pill.html')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Pill />
  </React.StrictMode>
)
