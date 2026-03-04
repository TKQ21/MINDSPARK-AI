import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Zap, Mail, Lock, User, Eye, EyeOff, Loader2 } from "lucide-react";
import StarBackground from "@/components/StarBackground";
import { toast } from "sonner";

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
        toast.success("Welcome back! 🚀");
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
        toast.success("Check your email to confirm your account! 📧");
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
    } catch (err: any) {
      toast.error(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <StarBackground />

      <div className="relative z-10 w-full max-w-md mx-4">
        {/* Logo Icon */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 animate-pulse-glow"
            style={{
              background: 'linear-gradient(135deg, hsl(270 100% 60%), hsl(180 100% 50%))',
              boxShadow: '0 0 25px hsl(270 100% 60% / 0.4), 0 0 50px hsl(180 100% 50% / 0.2)',
            }}
          >
            <Zap className="w-8 h-8 text-white" />
          </div>
          <h1
            className="font-orbitron text-3xl font-bold"
            style={{
              background: 'linear-gradient(90deg, hsl(180 100% 50%), hsl(330 100% 71%), hsl(55 100% 50%))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0 0 8px hsl(180 100% 50% / 0.3))',
            }}
          >
            MINDSPARK AI
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isLogin ? "Welcome back!" : "Join the future of AI"}
          </p>
        </div>

        {/* Auth Card */}
        <div
          className="rounded-2xl p-6 backdrop-blur-md"
          style={{
            background: 'hsl(230 20% 12% / 0.85)',
            border: '1px solid hsl(180 100% 50% / 0.15)',
            boxShadow: '0 0 30px hsl(180 100% 50% / 0.08), inset 0 0 30px hsl(180 100% 50% / 0.03)',
          }}
        >
          <form onSubmit={handleEmailAuth} className="space-y-4">
            {!isLogin && (
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neon-green" />
                <input
                  type="text"
                  placeholder="Full Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none transition-all"
                  style={{
                    background: 'hsl(230 15% 18% / 0.6)',
                    border: '1px solid hsl(120 100% 55% / 0.25)',
                    color: 'hsl(210 40% 92%)',
                    boxShadow: '0 0 8px hsl(120 100% 55% / 0.05)',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'hsl(120 100% 55% / 0.5)';
                    e.target.style.boxShadow = '0 0 15px hsl(120 100% 55% / 0.15)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'hsl(120 100% 55% / 0.25)';
                    e.target.style.boxShadow = '0 0 8px hsl(120 100% 55% / 0.05)';
                  }}
                  required
                />
              </div>
            )}

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neon-cyan" />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none transition-all"
                style={{
                  background: 'hsl(230 15% 18% / 0.6)',
                  border: '1px solid hsl(180 100% 50% / 0.25)',
                  color: 'hsl(210 40% 92%)',
                  boxShadow: '0 0 8px hsl(180 100% 50% / 0.05)',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'hsl(180 100% 50% / 0.5)';
                  e.target.style.boxShadow = '0 0 15px hsl(180 100% 50% / 0.15)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'hsl(180 100% 50% / 0.25)';
                  e.target.style.boxShadow = '0 0 8px hsl(180 100% 50% / 0.05)';
                }}
                required
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neon-purple" />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-12 py-3 rounded-xl text-sm focus:outline-none transition-all"
                style={{
                  background: 'hsl(230 15% 18% / 0.6)',
                  border: '1px solid hsl(270 100% 60% / 0.25)',
                  color: 'hsl(210 40% 92%)',
                  boxShadow: '0 0 8px hsl(270 100% 60% / 0.05)',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'hsl(270 100% 60% / 0.5)';
                  e.target.style.boxShadow = '0 0 15px hsl(270 100% 60% / 0.15)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'hsl(270 100% 60% / 0.25)';
                  e.target.style.boxShadow = '0 0 8px hsl(270 100% 60% / 0.05)';
                }}
                required
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{
                background: 'linear-gradient(135deg, hsl(270 100% 60%), hsl(180 100% 50%))',
                color: 'white',
                boxShadow: '0 0 20px hsl(270 100% 60% / 0.3), 0 0 40px hsl(180 100% 50% / 0.15)',
              }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {isLogin ? "Sign In" : "Sign Up"}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsl(230 15% 30%), transparent)' }} />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">OR</span>
            <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, hsl(230 15% 30%), transparent)' }} />
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full py-3 rounded-xl font-medium text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            style={{
              background: 'hsl(230 15% 18% / 0.6)',
              border: '1px solid hsl(55 100% 50% / 0.2)',
              color: 'hsl(210 40% 92%)',
              boxShadow: '0 0 8px hsl(55 100% 50% / 0.05)',
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

          <p className="text-center text-sm text-muted-foreground mt-5">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="ml-1 font-medium hover:underline"
              style={{
                background: 'linear-gradient(90deg, hsl(180 100% 50%), hsl(330 100% 71%))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {isLogin ? "Sign Up" : "Sign In"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
