// Loads ./.env into process.env for the scripts; missing file is fine
// (CI and the VPS pass variables through the environment).
// Читает ./.env в process.env для скриптов; без файла тоже работает.
export const loadEnv = () => {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* .env нет — переменные приходят из окружения */
  }
};