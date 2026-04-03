import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import {
  FileText,
  Users,
  Zap,
  Shield,
  ArrowRight,
  Download,
} from "lucide-react";
import SEO from "@/components/SEO";

const Index = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const checkUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        navigate("/dashboard");
      }
    };
    checkUser();
  }, [navigate]);

  const features = [
    {
      icon: FileText,
      title: "Rich Editorial Writing",
      desc: "Beautiful typography with serif fonts, markdown shortcuts, and a distraction-free experience.",
    },
    {
      icon: Users,
      title: "Real-Time Collaboration",
      desc: "See cursors, edits, and presence of your team. Conflict resolution built in.",
    },
    {
      icon: Zap,
      title: "Lightning Fast",
      desc: "Optimized with debounced saves, local-first editing, and instant sync.",
    },
    {
      icon: Shield,
      title: "Secure Sharing",
      desc: "Password-protected links, granular permissions, and version history.",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Write Beautifully, Together"
        description="A premium collaborative document editor with real-time editing, rich typography, and elegant design. Write beautifully, together."
        canonical="/"
        structuredData={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Collaborative Docx",
          description:
            "A premium collaborative document editor with real-time editing, rich typography, and elegant design.",
          applicationCategory: "Productivity",
          operatingSystem: "Web",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          featureList: [
            "Real-time collaboration",
            "Rich text editing",
            "Version history",
            "Document sharing",
            "Export to multiple formats",
          ],
        }}
      />

      {/* Nav */}
      <nav
        className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50"
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="container mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
            Collaborative Docx
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="font-ui text-sm"
              onClick={() => navigate("/auth")}
            >
              Sign In
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full sm:hidden"
                  aria-label="Download options"
                >
                  <Download className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={() => navigate("/download")}>
                  Download by Code
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => navigate("/download-folder")}
                >
                  Folder Download
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              className="font-ui text-sm rounded-full hidden sm:inline-flex"
              onClick={() => navigate("/download")}
            >
              Download by Code
            </Button>
            <Button
              variant="outline"
              className="font-ui text-sm rounded-full hidden sm:inline-flex"
              onClick={() => navigate("/download-folder")}
            >
              Folder Download
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section
        className="container mx-auto px-4 sm:px-6 pt-12 sm:pt-24 pb-12 sm:pb-20"
        aria-label="Hero"
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-3xl mx-auto text-center"
        >
          <h1 className="font-display text-3xl sm:text-5xl md:text-7xl font-bold tracking-tight text-foreground leading-[1.08] mb-4 sm:mb-6">
            Write beautifully,{" "}
            <span className="text-primary italic">together.</span>
          </h1>
          <p className="font-body text-base sm:text-lg md:text-xl text-muted-foreground max-w-xl mx-auto leading-relaxed mb-6 sm:mb-10">
            A collaborative writing experience designed for clarity, elegance,
            and flow. Where every word feels intentional.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button
              size="lg"
              onClick={() => navigate("/auth")}
              className="font-ui text-base px-8 py-6 rounded-full shadow-elevated hover:shadow-float transition-all duration-300"
            >
              Start Writing
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section
        className="container mx-auto px-4 sm:px-6 pb-16 sm:pb-24"
        aria-label="Features"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 max-w-4xl mx-auto">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.5,
                delay: 0.2 + i * 0.1,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="group p-6 rounded-xl border border-border/60 bg-card hover:shadow-elevated transition-all duration-300"
            >
              <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center mb-4">
                <f.icon className="h-5 w-5 text-accent-foreground" />
              </div>
              <h3 className="font-display text-lg font-semibold mb-2 text-card-foreground">
                {f.title}
              </h3>
              <p className="font-body text-sm text-muted-foreground leading-relaxed">
                {f.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8" role="contentinfo">
        <p className="text-center text-sm text-muted-foreground font-ui">
          Crafted with care. Built for writers.
        </p>
      </footer>
    </div>
  );
};

export default Index;
