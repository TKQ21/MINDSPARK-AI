import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Sparkles, Mail, Lock, User, Eye, EyeOff, Loader2, ArrowRight, Cpu, Zap, Shield } from "lucide-react";
import { toast } from "sonner";
import { clearLegacyMindSparkKeys } from "@/lib/userStorage";

const Auth: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        clearLegacyMindSparkKeys();
        toast.success("Welcome back");
        navigate("/");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (error) throw error;
      clearLegacyMindSparkKeys();
    } catch (err: any) {
      toast.error(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full relative overflow-hidden bg-[hsl(230_30%_5%)]">
      {/* Premium Aurora Background */}
      <div className="absolute inset-0 -z-10">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 20% 10%, hsl(270 85% 25% / 0.55), transparent 60%)," +
              "radial-gradient(ellipse 60% 50% at 90% 30%, hsl(180 90% 30% / 0.45), transparent 60%)," +
              "radial-gradient(ellipse 70% 60% at 50% 100%, hsl(330 85% 35% / 0.35), transparent 60%)," +
              "linear-gradient(180deg, hsl(230 35% 6%) 0%, hsl(235 40% 4%) 100%)",
          }}
        />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(180 100% 60% / 0.08) 1px, transparent 1px), linear-gradient(90deg, hsl(180 100% 60% / 0.08) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse 70% 70% at 50% 50%, black, transparent 75%)",
          }}
        />
        {/* Floating orbs */}
        <div
          className="absolute rounded-full animate-float"
          style={{
            top: "12%",
            left: "15%",
            width: 280,
            height: 280,
            background: "radial-gradient(circle, hsl(270 100% 60% / 0.35), transparent 65%)",
            filter: "blur(50px)",
          }}
        />
        <div
          className="absolute rounded-full animate-float"
          style={{
            bottom: "10%",
            right: "12%",
            width: 340,
            height: 340,
            background: "radial-gradient(circle, hsl(180 100% 50% / 0.28), transparent 65%)",
            filter: "blur(60px)",
            animationDelay: "2s",
          }}
        />
        <div
          className="absolute rounded-full animate-float"
          style={{
            top: "55%",
            left: "45%",
            width: 220,
            height: 220,
            background: "radial-gradient(circle, hsl(330 100% 65% / 0.22), transparent 65%)",
            filter: "blur(55px)",
            animationDelay: "4s",
          }}
        />
        {/* Noise grain */}
        <div
          className="absolute inset-0 opacity-[0.06] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
      </div>

      <div className="min-h-screen w-full grid lg:grid-cols-2">
        {/* LEFT — Brand panel */}
        <div className="hidden lg:flex flex-col justify-between p-12 relative">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center relative"
              style={{
                background: "linear-gradient(135deg, hsl(270 100% 60%), hsl(180 100% 50%))",
                boxShadow: "0 8px 32px hsl(270 100% 60% / 0.4)",
              }}
            >
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-orbitron text-lg font-bold tracking-wider text-white">MINDSPARK</div>
              <div className="text-[10px] tracking-[0.3em] text-cyan-300/60 uppercase">AI Platform</div>
            </div>
          </div>

          <div className="space-y-10 max-w-lg">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-6 text-xs"
                style={{
                  background: "hsl(180 100% 50% / 0.08)",
                  border: "1px solid hsl(180 100% 50% / 0.25)",
                  color: "hsl(180 100% 75%)",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Powered by Gemini 3 Pro
              </div>
              <h2 className="font-orbitron text-5xl xl:text-6xl font-bold leading-[1.05] text-white mb-5">
                Think.
                <br />
                <span style={{
                  background: "linear-gradient(90deg, hsl(180 100% 60%), hsl(270 100% 70%), hsl(330 100% 75%))",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}>
                  Beyond limits.
                </span>
              </h2>
              <p className="text-base text-slate-300/80 leading-relaxed font-light">
                A premium AI workspace for reasoning, code, document intelligence, and creative generation — all in one elegant interface.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { icon: Cpu, label: "Reasoning", v: "Gemini 3" },
                { icon: Shield, label: "Private", v: "Encrypted" },
                { icon: Zap, label: "Realtime", v: "Streaming" },
              ].map((f, i) => (
                <div
                  key={i}
                  className="p-4 rounded-xl backdrop-blur-md transition-all hover:-translate-y-0.5"
                  style={{
                    background: "hsl(230 30% 10% / 0.55)",
                    border: "1px solid hsl(180 100% 50% / 0.12)",
                  }}
                >
                  <f.icon className="w-4 h-4 text-cyan-300 mb-2" />
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">{f.label}</div>
                  <div className="text-xs text-white font-medium mt-0.5">{f.v}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-slate-500 font-mono">
            © 2026 MINDSPARK · v3.1
          </div>
        </div>

        {/* RIGHT — Auth form */}
        <div className="flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md">
            {/* Mobile logo */}
            <div className="lg:hidden text-center mb-8">
              <div
                className="inline-flex w-14 h-14 rounded-xl items-center justify-center mb-3"
                style={{
                  background: "linear-gradient(135deg, hsl(270 100% 60%), hsl(180 100% 50%))",
                  boxShadow: "0 8px 32px hsl(270 100% 60% / 0.4)",
                }}
              >
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div className="font-orbitron text-xl font-bold text-white">MINDSPARK</div>
            </div>

            <div
              className="rounded-3xl p-8 lg:p-10 backdrop-blur-2xl relative overflow-hidden"
              style={{
                background: "linear-gradient(160deg, hsl(230 30% 10% / 0.75), hsl(235 35% 7% / 0.85))",
                border: "1px solid hsl(180 100% 60% / 0.1)",
                boxShadow:
                  "0 30px 80px -20px hsl(270 100% 30% / 0.4), 0 0 0 1px hsl(0 0% 100% / 0.03) inset",
              }}
            >
              {/* Top accent line */}
              <div
                className="absolute top-0 left-8 right-8 h-px"
                style={{
                  background: "linear-gradient(90deg, transparent, hsl(180 100% 60% / 0.6), hsl(330 100% 70% / 0.6), transparent)",
                }}
              />

              <div className="mb-7">
                <div className="text-[10px] tracking-[0.35em] uppercase text-cyan-300/70 mb-2">
                  {isLogin ? "Welcome back" : "Create account"}
                </div>
                <h1 className="font-orbitron text-3xl font-bold text-white">
                  {isLogin ? "Sign in" : "Get started"}
                </h1>
                <p className="text-sm text-slate-400 mt-2 font-light">
                  {isLogin ? "Continue to your AI workspace." : "A free account unlocks everything."}
                </p>
              </div>

              <form onSubmit={handleEmailAuth} className="space-y-3.5">
                {!isLogin && (
                  <Field
                    icon={User}
                    type="text"
                    placeholder="Full name"
                    value={name}
                    onChange={setName}
                    required
                  />
                )}
                <Field
                  icon={Mail}
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={setEmail}
                  required
                />
                <div className="relative">
                  <Field
                    icon={Lock}
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    value={password}
                    onChange={setPassword}
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-cyan-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="group w-full py-3.5 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-5 relative overflow-hidden"
                  style={{
                    background: "linear-gradient(135deg, hsl(270 100% 62%), hsl(200 100% 55%) 50%, hsl(180 100% 50%))",
                    color: "white",
                    boxShadow: "0 10px 30px -10px hsl(270 100% 60% / 0.6), inset 0 1px 0 hsl(0 0% 100% / 0.2)",
                  }}
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      {isLogin ? "Sign in" : "Create account"}
                      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </button>
              </form>

              <div className="my-6 flex items-center gap-3">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
                <span className="text-[10px] tracking-[0.3em] text-slate-500 uppercase">or continue with</span>
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent" />
              </div>

              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full py-3 rounded-xl font-medium text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-3 hover:bg-white/[0.04]"
                style={{
                  background: "hsl(230 25% 14% / 0.6)",
                  border: "1px solid hsl(0 0% 100% / 0.08)",
                  color: "hsl(210 40% 95%)",
                }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>

              <p className="text-center text-sm text-slate-400 mt-7">
                {isLogin ? "New here?" : "Already have an account?"}
                <button
                  onClick={() => setIsLogin(!isLogin)}
                  className="ml-1.5 font-semibold hover:underline"
                  style={{
                    background: "linear-gradient(90deg, hsl(180 100% 65%), hsl(330 100% 75%))",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {isLogin ? "Create an account" : "Sign in instead"}
                </button>
              </p>
            </div>

            <p className="text-center text-[11px] text-slate-500 mt-6 font-light">
              By continuing you agree to our Terms & Privacy Policy.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

interface FieldProps {
  icon: React.ComponentType<{ className?: string }>;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
}

const Field: React.FC<FieldProps> = ({ icon: Icon, type, placeholder, value, onChange, required, minLength }) => (
  <div className="relative group">
    <Icon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-cyan-300 transition-colors" />
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      minLength={minLength}
      className="w-full pl-11 pr-4 py-3.5 rounded-xl text-sm focus:outline-none transition-all text-white placeholder:text-slate-500"
      style={{
        background: "hsl(230 25% 12% / 0.7)",
        border: "1px solid hsl(0 0% 100% / 0.06)",
      }}
      onFocus={(e) => {
        e.target.style.borderColor = "hsl(180 100% 60% / 0.45)";
        e.target.style.boxShadow = "0 0 0 3px hsl(180 100% 50% / 0.08)";
      }}
      onBlur={(e) => {
        e.target.style.borderColor = "hsl(0 0% 100% / 0.06)";
        e.target.style.boxShadow = "none";
      }}
    />
  </div>
);

export default Auth;
