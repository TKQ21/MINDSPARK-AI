import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import ChatInterface from "@/components/ChatInterface";
import { clearLegacyMindSparkKeys } from "@/lib/userStorage";

const Index = () => {
  const [userName, setUserName] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        navigate("/auth");
      } else {
        clearLegacyMindSparkKeys();
        setUserName(session.user.user_metadata?.full_name || session.user.email || "User");
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate("/auth");
      } else {
        clearLegacyMindSparkKeys();
        setUserName(session.user.user_metadata?.full_name || session.user.email || "User");
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  if (loading) return null;

  return <ChatInterface userName={userName} />;
};

export default Index;
