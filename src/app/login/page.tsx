import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

// Login je mimo (app) route group → bez sidebaru. Prihlásených presmeruje Proxy
// preč z /login.
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">BAMIPA</h1>
          <p className="text-sm text-muted-foreground">
            výrobno-nákladový systém
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
