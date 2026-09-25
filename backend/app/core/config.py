from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "sqlite:///./moil.db"
    model_dir: str = "./artifacts"
    cog_path: str = "/data/cogs/prospectivity.tif"
    titiler_public_url: str = "http://localhost:8001"
    cors_origins: list[str] = ["*"]
    open_meteo_url: str = "https://api.open-meteo.com/v1/forecast"
    open_meteo_archive_url: str = "https://archive-api.open-meteo.com/v1/archive"   # ERA5, keyless
    data_mode: str = "demo"          # demo = synthetic data, live = real feeds
    api_key: str = "change-me"       # protects /ingest and /actions/refresh


settings = Settings()
