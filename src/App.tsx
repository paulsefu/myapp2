import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import ObjectiveVaultApp from "./components/ObjectiveVaultApp";
import { isSupabaseConfigured, requireSupabase, supabase } from "./lib/supabase";

type AuthMode = "login" | "register";

function LoadingScreen() {
  return (
    <main className="security-page">
      <div className="loading-mark" aria-label="Se încarcă" />
      <p>Se pregătește aplicația…</p>
    </main>
  );
}

function ConfigurationScreen() {
  return (
    <main className="security-page">
      <section className="security-card">
        <div className="brand-mark" aria-hidden="true">!</div>
        <p className="eyebrow">OBIECTIVE FINANCIARE</p>
        <h1>Lipsește conexiunea</h1>
        <p className="security-copy">
          Completează fișierul <strong>public/config.js</strong> cu Project URL și cheia anon din Supabase.
        </p>
        <div className="security-features">
          <span>Nu folosi cheia service_role</span>
          <span>Cheia anon este destinată aplicației web</span>
          <span>Rulează apoi din nou publicarea</span>
        </div>
      </section>
    </main>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!email.trim()) return setError("Introdu adresa de email.");
    if (password.length < 8) return setError("Parola trebuie să aibă cel puțin 8 caractere.");

    setSubmitting(true);
    try {
      const client = requireSupabase();
      if (mode === "login") {
        const { error: signInError } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      } else {
        const redirectUrl = window.location.href.split("#")[0].split("?")[0];
        const { data, error: signUpError } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: redirectUrl },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setMessage("Cont creat. Verifică emailul și apasă linkul de confirmare, apoi revino aici.");
        }
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Autentificarea nu a reușit.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="security-page">
      <section className="security-card">
        <div className="brand-mark" aria-hidden="true">◈</div>
        <p className="eyebrow">OBIECTIVE FINANCIARE</p>
        <h1>Planul tău privat</h1>
        <p className="security-copy">
          Autentifică-te pentru a accesa seiful criptat. Datele pot fi citite doar după introducerea parolei tale de criptare.
        </p>

        <div className="auth-switch" role="tablist" aria-label="Autentificare">
          <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>Intră în cont</button>
          <button className={mode === "register" ? "active" : ""} type="button" onClick={() => setMode("register")}>Creează cont</button>
        </div>

        <form className="security-form" onSubmit={submit}>
          <label>
            Email
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nume@email.ro" />
          </label>
          <label>
            Parolă cont
            <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Minimum 8 caractere" />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="form-success" role="status">{message}</p>}
          <button className="button button-primary button-wide" disabled={submitting}>
            {submitting ? "Se verifică…" : mode === "login" ? "Continuă în siguranță" : "Creează contul"}
          </button>
        </form>

        <div className="security-features">
          <span>Criptare pe dispozitiv</span>
          <span>Sincronizare privată</span>
          <span>Cheie de recuperare</span>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setLoading(false);
      }
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  if (!isSupabaseConfigured) return <ConfigurationScreen />;
  if (loading) return <LoadingScreen />;
  if (!session?.user) return <AuthScreen />;

  const displayName =
    (session.user.user_metadata?.display_name as string | undefined) ||
    session.user.email?.split("@")[0] ||
    "Utilizator";

  return (
    <ObjectiveVaultApp
      displayName={displayName}
      onSignOut={async () => {
        const { error } = await requireSupabase().auth.signOut();
        if (error) throw error;
      }}
    />
  );
}
