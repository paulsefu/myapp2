/// <reference types="vite/client" />

type ObiectiveRuntimeConfig = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

interface Window {
  __OBIECTIVE_CONFIG__?: ObiectiveRuntimeConfig;
}
