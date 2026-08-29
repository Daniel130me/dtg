import Header from "@/components/prototype/layout/Header";
import Footer from "@/components/prototype/layout/Footer";
import { Toaster } from "@/components/ui/sonner";

export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      {children}
      <Footer />
      {/* Public surfaces use sonner for enrolment feedback (mirrors the owner layout). */}
      <Toaster position="bottom-right" richColors />
    </div>
  );
}
