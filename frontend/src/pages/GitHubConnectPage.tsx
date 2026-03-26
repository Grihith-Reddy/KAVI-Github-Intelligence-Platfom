import axios from 'axios'
import { motion } from 'framer-motion'
import { Github, Shield, Link2, ArrowRight, Zap, MoveRight } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useApiClient } from '../services/apiClient'
import { getGitHubConnectUrl } from '../services/githubService'
import { getApiErrorMessage } from '../utils/errors'
import cloudImg from '../assets/cloud.webp'

export function GitHubConnectPage() {
  const api = useApiClient()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleConnect = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getGitHubConnectUrl(api)
      window.location.href = data.url
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        navigate('/login?returnTo=%2Fconnect-github', { replace: true })
        return
      }
      setError(
        getApiErrorMessage(
          err,
          'Unable to start GitHub connection. Verify backend is running.'
        )
      )
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Audiowide&display=swap');        
        .connect-page-wrapper {
          background: #fff;
          min-height: 100vh;
          padding: 16px;
          display: flex;
          flex-direction: column;
          font-family: 'Gabarito', sans-serif;
        }

        .connect-card {
          position: relative;
          flex: 1;
          width: 100%;
          max-width: 1440px;
          margin: 0 auto;
          background: linear-gradient(170deg, #15aeea 0%, #73cef2 100%);
          border-radius: 32px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          clip-path: inset(0% round 32px);
        }

        .hero-cloud {
          position: absolute;
          width: 120%;
          left: -10%;
          bottom: -10%;
          opacity: 0.6;
          mix-blend-mode: screen;
          pointer-events: none;
          z-index: 1;
        }

        .inner-content {
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(20px);
          border-radius: 24px;
          padding: 40px;
          width: 100%;
          max-width: 480px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          z-index: 10;
        }

        .connection-visual {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          margin-bottom: 32px;
          color: #181D1F;
        }

        .visual-circle {
          width: 48px;
          height: 48px;
          background: #fff;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
          border: 1px solid rgba(0,0,0,0.05);
        }

        .font-archivo { font-family: 'Archivo', sans-serif !important; }
        
        .k-logo-img { 
          height: 24px; 
          filter: brightness(0);
        }

        .feature-row {
          display: flex;
          gap: 12px;
          padding: 16px;
          background: rgba(0,0,0,0.03);
          border-radius: 16px;
          margin-bottom: 12px;
          border: 1px solid rgba(0,0,0,0.05);
        }

        .btn-github {
          width: 100%;
          padding: 14px;
          background: #181D1F;
          color: #fff;
          border-radius: 9999px;
          border: none;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: transform 0.2s ease;
          margin-top: 24px;
        }

        .btn-github:hover { transform: translateY(-2px); }
        .btn-github:disabled { opacity: 0.7; cursor: not-allowed; }
      `}</style>

      <div className="connect-page-wrapper">
        <div className="connect-card">
          {/* Background Clouds */}
          <img src={cloudImg} alt="" className="hero-cloud" />

          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="inner-content"
          >
            {/* Logo Header visual */}
            <div className="connection-visual">
              <div className="visual-circle">
                <Zap size={24} fill="#181D1F" />
              </div>
              <MoveRight className="text-gray-400" size={20} />
              <div className="visual-circle">
                <Github size={24} fill="#181D1F" />
              </div>
            </div>

            <h1 className="text-center font-archivo" style={{ fontSize: '28px', fontWeight: 700, color: '#181D1F', marginBottom: '8px' }}>
              Connect GitHub
            </h1>
            
            <p className="text-center" style={{ color: '#424647', fontSize: '15px', marginBottom: '32px', lineHeight: 1.5 }}>
              Kavi builds your team's architecture memory by indexing pull-request discussions.
            </p>

            <div className="features">
              <div className="feature-row">
                <Shield size={18} style={{ color: '#181D1F', marginTop: '2px' }} />
                <div>
                  <p className="font-archivo" style={{ fontWeight: 600, fontSize: '14px', color: '#181D1F' }}>Read-only Access</p>
                  <p style={{ fontSize: '13px', color: '#424647' }}>Kavi never modifies your code or settings.</p>
                </div>
              </div>

              <div className="feature-row">
                <Link2 size={18} style={{ color: '#181D1F', marginTop: '2px' }} />
                <div>
                  <p className="font-archivo" style={{ fontWeight: 600, fontSize: '14px', color: '#181D1F' }}>Context Indexing</p>
                  <p style={{ fontSize: '13px', color: '#424647' }}>We only index metadata from your PR threads.</p>
                </div>
              </div>
            </div>

            {error && (
              <div style={{ marginTop: '16px', padding: '12px', background: '#fee2e2', borderRadius: '12px', color: '#b91c1c', fontSize: '13px' }}>
                {error}
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={loading}
              className="btn-github font-archivo"
            >
              <Github size={18} />
              {loading ? 'Redirecting...' : 'Continue with GitHub'}
              <ArrowRight size={16} />
            </button>

            
          </motion.div>
        </div>
      </div>
    </>
  )
}
