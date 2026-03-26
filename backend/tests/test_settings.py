import unittest

from cryptography.fernet import Fernet

from app.core.settings import Settings


class SettingsValidationTests(unittest.TestCase):
    def test_invalid_fernet_key_fails_validation(self):
        cfg = Settings(
            _env_file=None,
            GITHUB_STATE_SECRET="super-secret-value",
            TOKEN_ENCRYPTION_KEY="invalid-key",
        )

        with self.assertRaises(RuntimeError):
            cfg.validate_runtime()

    def test_production_rejects_localhost_origin(self):
        cfg = Settings(
            _env_file=None,
            ENV="production",
            FRONTEND_URL="http://localhost:5173",
            FIREBASE_PROJECT_ID="kavi-prod",
            FIREBASE_CREDENTIALS_JSON='{"type":"service_account","project_id":"kavi-prod"}',
            GITHUB_CLIENT_ID="client-id",
            GITHUB_CLIENT_SECRET="client-secret",
            GITHUB_OAUTH_REDIRECT_URI="https://api.example.com/api/github/callback",
            GITHUB_STATE_SECRET="super-secret-value",
            TOKEN_ENCRYPTION_KEY=Fernet.generate_key().decode(),
        )

        with self.assertRaises(RuntimeError):
            cfg.validate_runtime()

    def test_production_accepts_secure_runtime_settings(self):
        cfg = Settings(
            _env_file=None,
            ENV="production",
            FRONTEND_URL="https://kavi.example.com",
            FIREBASE_PROJECT_ID="kavi-prod",
            FIREBASE_CREDENTIALS_JSON='{"type":"service_account","project_id":"kavi-prod"}',
            GITHUB_CLIENT_ID="client-id",
            GITHUB_CLIENT_SECRET="client-secret",
            GITHUB_OAUTH_REDIRECT_URI="https://api.example.com/api/github/callback",
            GITHUB_STATE_SECRET="super-secret-value",
            TOKEN_ENCRYPTION_KEY=Fernet.generate_key().decode(),
        )

        cfg.validate_runtime()


if __name__ == "__main__":
    unittest.main()
