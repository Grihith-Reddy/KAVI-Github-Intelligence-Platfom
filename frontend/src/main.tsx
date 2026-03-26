import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './app/App'
import { AuthProvider } from './features/auth/AuthProvider'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>
)
