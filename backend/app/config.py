from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    secret_key: str = "dev-secret-change-me"
    database_url: str = "sqlite:///./finance.db"
    access_token_expire_minutes: int = 60 * 24
    algorithm: str = "HS256"
    cors_origins: str = "http://localhost:5173"

    genai_base_url: str = "https://genai-sharedservice-emea.pwc.com"
    genai_api_key: str = ""
    genai_api_version: str = ""
    genai_llm_model: str = "openai.gpt-5-nano"
    genai_chat_model: str = "openai.gpt-5.4-mini"

    @property
    def genai_enabled(self) -> bool:
        return bool(self.genai_api_key)

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
